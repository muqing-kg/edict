"""MVP tests for proactive task notify pipeline."""

import asyncio
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'edict' / 'backend'))

import kanban_update as kb  # noqa: E402
import notify_send_openclaw as notify_cli  # noqa: E402
from app.services.event_bus import TOPIC_TASK_NOTIFY  # noqa: E402
from app.services.notify_support import build_notify_payload, ensure_notify_scheduler  # noqa: E402
from app.workers.notify_worker import GROUP, JsonTaskNotifyStore, NotifyWorker, _detect_repo_root  # noqa: E402


class FakeBus:
    def __init__(self, *, consume_events=None, stale_events=None):
        self.consume_events = list(consume_events or [])
        self.stale_events = list(stale_events or [])
        self.acks = []
        self.published = []
        self.groups = []
        self.connected = False

    async def connect(self):
        self.connected = True

    async def close(self):
        self.connected = False

    async def ensure_consumer_group(self, topic, group):
        self.groups.append((topic, group))

    async def publish(self, **kwargs):
        self.published.append(kwargs)

    async def consume(self, topic, group, consumer, count=0, block_ms=0):
        events = list(self.consume_events)
        self.consume_events.clear()
        return events

    async def claim_stale(self, topic, group, consumer, min_idle_ms=0, count=0):
        events = list(self.stale_events)
        self.stale_events.clear()
        return events

    async def ack(self, topic, group, entry_id):
        self.acks.append((topic, group, entry_id))


def test_detect_repo_root_handles_container_layout():
    assert _detect_repo_root(pathlib.Path('/app/app/workers/notify_worker.py')) == pathlib.Path('/app')



def test_openclaw_command_sink_render_and_build():
    text = notify_cli.render_message(
        {
            'task_id': 'T-NOTIFY-CLI',
            'title': '主动汇报联调',
            'kind': 'done',
            'state': 'Done',
            'org': '中继',
            'message': 'MVP 已完成并回传',
        }
    )
    assert 'T-NOTIFY-CLI' in text
    assert 'MVP 已完成并回传' in text

    cmd = notify_cli.build_command(
        {
            'channel': 'feishu',
            'to': 'ou_cli_target',
            'accountId': 'default',
            'threadId': 'omt_123',
        },
        text,
    )
    assert cmd[:7] == ['openclaw', 'message', 'send', '--channel', 'feishu', '--target', 'ou_cli_target']
    assert '--account' in cmd and 'default' in cmd
    assert '--thread-id' in cmd and 'omt_123' in cmd



def test_key_actions_emit_task_notify(tmp_path, monkeypatch):
    tasks_file = tmp_path / 'tasks_source.json'
    tasks_file.write_text('[]', encoding='utf-8')
    emitted = []

    monkeypatch.setattr(kb, 'TASKS_FILE', tasks_file)
    monkeypatch.setattr(kb, '_trigger_refresh', lambda: None)
    monkeypatch.setattr(kb, '_publish_notify_payload', lambda payload, producer='kanban_update': emitted.append(payload) or True)
    monkeypatch.setenv('EDICT_NOTIFY_CHANNEL', 'feishu')
    monkeypatch.setenv('EDICT_NOTIFY_TO', 'ou_notify_target')
    monkeypatch.setenv('EDICT_NOTIFY_SOURCE_SESSION_KEY', 'agent:main:feishu:direct:test')

    kb.cmd_create('T-NOTIFY-001', '验证任务主动汇报闭环', 'Pending', '机务', '机务')
    kb.cmd_progress('T-NOTIFY-001', '正在实现 notify worker', '分析✅|编码🔄|测试')
    kb.cmd_block('T-NOTIFY-001', '等待 Redis 恢复')
    kb.cmd_done('T-NOTIFY-001', '/tmp/out.md', 'notify MVP 已完成')

    assert [payload['kind'] for payload in emitted] == ['ack', 'progress', 'blocked', 'done']
    assert all(payload['route']['channel'] == 'feishu' for payload in emitted)
    assert all(payload['route']['to'] == 'ou_notify_target' for payload in emitted)

    tasks = json.loads(tasks_file.read_text(encoding='utf-8'))
    task = tasks[0]
    notify = ((task.get('_scheduler') or {}).get('notify') or {})
    assert notify['route']['to'] == 'ou_notify_target'
    assert notify['pending']
    assert notify['recovery']['needsCatchup'] is True


def test_notify_worker_ack_reclaim_and_dedupe(tmp_path):
    tasks_file = tmp_path / 'tasks_source.json'
    outbox = tmp_path / 'notify_outbox.jsonl'

    task = {
        'id': 'T-NOTIFY-002',
        'title': '验证 notify worker ACK 与去重',
        'state': 'Doing',
        'org': '机务',
        'now': '正在执行',
        '_scheduler': ensure_notify_scheduler(
            {},
            route={'channel': 'feishu', 'to': 'ou_worker_target', 'sourceSessionKey': 'agent:main:feishu:direct:worker'},
            stage='Assigned',
            needs_catchup=True,
        ),
    }
    tasks_file.write_text(json.dumps([task], ensure_ascii=False, indent=2), encoding='utf-8')

    payload = build_notify_payload(
        task,
        kind='progress',
        message='关键进展：notify worker 已启动',
        trigger='test.progress',
        route={'channel': 'feishu', 'to': 'ou_worker_target'},
        stable_part='progress-1',
        dedupe_window_sec=120,
    )

    bus = FakeBus(
        stale_events=[('1-0', {'payload': payload})],
        consume_events=[('2-0', {'payload': payload})],
    )
    store = JsonTaskNotifyStore(tasks_file)
    worker = NotifyWorker(bus=bus, store=store, outbox_path=outbox, min_idle_ms=1)

    asyncio.run(worker._startup_reconcile())
    assert bus.published, 'startup reconcile should publish a recovery intent'
    assert bus.published[0]['topic'] == TOPIC_TASK_NOTIFY

    asyncio.run(worker._recover_pending())
    asyncio.run(worker._poll_cycle())

    lines = [line for line in outbox.read_text(encoding='utf-8').splitlines() if line.strip()]
    assert len(lines) == 1, 'duplicate event should not generate a second delivery'

    delivered = json.loads(lines[0])
    assert delivered['notify_key'] == payload['notify_key']
    assert delivered['route']['to'] == 'ou_worker_target'

    assert bus.acks == [
        (TOPIC_TASK_NOTIFY, GROUP, '1-0'),
        (TOPIC_TASK_NOTIFY, GROUP, '2-0'),
    ]

    updated_task = json.loads(tasks_file.read_text(encoding='utf-8'))[0]
    notify = ((updated_task.get('_scheduler') or {}).get('notify') or {})
    assert notify['lastDeliveredKey'] == payload['notify_key']
    assert notify['recovery']['needsCatchup'] is False
