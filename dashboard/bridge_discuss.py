"""
节点会商引擎 — 多节点实时讨论系统

灵感来源于 nvwa 项目的 group_chat + crew_engine
将节点可视化、实时讨论与用户（主人）参与融合到舰载系统协作场景。

功能:
  - 选择节点参与会商
  - 围绕指令/议题进行多轮群聊讨论
  - 主人可随时发言、注入系统事件干预
  - 命运骰子：随机事件
  - 每个节点保持各自的角色性格和表达风格
"""

import json
import logging
import os
import time
import uuid

logger = logging.getLogger('bridge_discuss')

# ── 节点角色设定 ──

NODE_PROFILES = {
    'main': {
        'name': '云霄', 'emoji': '🧭', 'role': '入口分拣核心',
        'duty': '负责输入分拣与需求提炼。判断事务优先级，简单事项直接归类，复杂事项提炼后转交星枢，并持续跟踪各节点进展。',
        'personality': '反应迅速，擅长抓重点，偏行动派。',
        'speaking_style': '简洁直接，喜欢先给结论再补充依据。'
    },
    'xingshu': {
        'name': '星枢', 'emoji': '🧠', 'role': '规划与起草中枢',
        'duty': '负责方案规划与流程设计。接收指令后起草执行路径，提交棱镜校核，通过后交中继路由。只规划不直接执行，方案需清晰可落地。',
        'personality': '沉稳理性，擅长系统化拆解问题。',
        'speaking_style': '喜欢结构化表达，常按步骤或模块展开。'
    },
    'lengjing': {
        'name': '棱镜', 'emoji': '🔍', 'role': '审核校核模块',
        'duty': '负责从可行性、完整性、风险与资源四个维度校核方案，有权退回修订。发现漏洞必须明确指出，并给出可执行建议。',
        'personality': '严谨克制，善于发现盲点。',
        'speaking_style': '常用质询式表达，重点指出风险与缺口。'
    },
    'zhongji': {
        'name': '中继', 'emoji': '📡', 'role': '总协调与任务路由',
        'duty': '负责任务派发与执行协调。接收通过校核的方案后判断应路由到哪些节点执行，汇总结果后回传。',
        'personality': '执行导向，重视节奏与资源分配。',
        'speaking_style': '直接利落，偏调度口吻。'
    },
    'wenshu': {
        'name': '文枢', 'emoji': '📝', 'role': '文档与规范模块',
        'duty': '负责文档规范、对外说明、变更日志与输出模板；审视文案一致性与信息可读性。',
        'personality': '注重表达质量与结构一致性。',
        'speaking_style': '措辞清晰，强调格式、标准与可读性。'
    },
    'yuanliu': {
        'name': '源流', 'emoji': '💰', 'role': '数据与资源模块',
        'duty': '负责数据统计、资源管理、性能指标与成本分析；产出报表并评估投入产出。',
        'personality': '谨慎务实，对资源变化敏感。',
        'speaking_style': '喜欢引用数据和资源约束说话。'
    },
    'weikong': {
        'name': '维控', 'emoji': '🛡️', 'role': '运维与安全模块',
        'duty': '负责基础设施、部署、回滚、监控与安全保障；确保上线过程稳态可控。',
        'personality': '警觉果断，优先考虑稳定性和应急响应。',
        'speaking_style': '判断明确，偏应急与保障口吻。'
    },
    'tanzhen': {
        'name': '探针', 'emoji': '⚖️', 'role': '质量与合规模块',
        'duty': '负责代码审查、测试覆盖、边界条件、异常处理与合规审计；把控质量底线。',
        'personality': '冷静严格，习惯先找风险。',
        'speaking_style': '逻辑清晰，常按风险等级给结论。'
    },
    'jiwu': {
        'name': '机务', 'emoji': '🔧', 'role': '工程实现模块',
        'duty': '负责需求分析、架构设计、代码实现、接口对接、重构与性能优化。',
        'personality': '偏技术实现，愿意快速原型验证。',
        'speaking_style': '常从技术角度展开，偏实现细节。'
    },
    'xulie': {
        'name': '序列', 'emoji': '👔', 'role': '人事与组织模块',
        'duty': '负责成员接入、能力评估、协作规范、知识库维护与组织编排，确保关键岗位与协作链路稳定。',
        'personality': '擅长统筹人力与协作关系。',
        'speaking_style': '关注负载、分工与协同效率。'
    },
}

# ── 命运骰子事件 ──

FATE_EVENTS = [
    '监控告警：核心链路延迟陡增，需立即评估应急方案',
    '观测异常：关键指标与预期偏离，需重新校准方向',
    '资源播报：预算池突然增加一倍，可重新评估投入强度',
    '安全预警：依赖链路出现高危漏洞，必须调整优先级',
    '上游波动：外部接口响应异常，需准备降级与回滚方案',
    '现场回报：用户反馈出现全新使用场景，方案需要扩展',
    '负载攀升：多个旧问题同时回流，关键节点压力升高',
    '窗口压缩：上线时间被缩短到半天内，必须快速收敛方案',
    '合规通知：新增审计要求，所有关键步骤都要补充留痕',
    '情报更新：发现竞争对手新动作，需要快速调整策略',
    '资源重分配：部分算力被临时征用，需重新规划执行顺序',
    '联调提示：另一条业务链路暴露出可复用方案，值得参考',
    '系统播报：关键模块完成预研，部分约束已经解除',
    '风险上浮：一个被忽视的边界条件可能影响整体稳定性',
    '协作请求：外部团队发来并行协作邀请，带来机会也带来依赖',
    '突发任务：必须在极短窗口内拿出阶段性结论',
]

# ── Session 管理 ──

_sessions: dict[str, dict] = {}


def create_session(topic: str, node_ids: list[str], task_id: str = '') -> dict:
    """创建新的节点会商会话。"""
    session_id = str(uuid.uuid4())[:8]

    nodes = []
    for oid in node_ids:
        profile = NODE_PROFILES.get(oid)
        if profile:
            nodes.append({**profile, 'id': oid})

    if not nodes:
        return {'ok': False, 'error': '至少选择一位节点'}

    session = {
        'session_id': session_id,
        'topic': topic,
        'task_id': task_id,
        'nodes': nodes,
        'messages': [{
            'type': 'system',
            'content': f'🛰 节点会商开始 —— 议题：{topic}',
            'timestamp': time.time(),
        }],
        'round': 0,
        'phase': 'discussing',  # discussing | concluded
        'created_at': time.time(),
    }

    _sessions[session_id] = session
    return _serialize(session)


def advance_discussion(session_id: str, user_message: str = None,
                       system_event: str = None) -> dict:
    """推进一轮讨论，使用内置模拟或 LLM。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}

    session['round'] += 1
    round_num = session['round']

    # 记录主人发言
    if user_message:
        session['messages'].append({
            'type': 'owner',
            'content': user_message,
            'timestamp': time.time(),
        })

    # 记录系统事件
    if system_event:
        session['messages'].append({
            'type': 'system_event',
            'content': system_event,
            'timestamp': time.time(),
        })

    # 尝试用 LLM 生成讨论
    llm_result = _llm_discuss(session, user_message, system_event)

    if llm_result:
        new_messages = llm_result.get('messages', [])
        scene_note = llm_result.get('scene_note')
    else:
        # 降级到规则模拟
        new_messages = _simulated_discuss(session, user_message, system_event)
        scene_note = None

    # 添加到历史
    for msg in new_messages:
        session['messages'].append({
            'type': 'node',
            'node_id': msg.get('node_id', ''),
            'node_name': msg.get('name', ''),
            'content': msg.get('content', ''),
            'emotion': msg.get('emotion', 'neutral'),
            'action': msg.get('action'),
            'timestamp': time.time(),
        })

    if scene_note:
        session['messages'].append({
            'type': 'scene_note',
            'content': scene_note,
            'timestamp': time.time(),
        })

    return {
        'ok': True,
        'session_id': session_id,
        'round': round_num,
        'new_messages': new_messages,
        'scene_note': scene_note,
        'total_messages': len(session['messages']),
    }


def get_session(session_id: str) -> dict | None:
    session = _sessions.get(session_id)
    if not session:
        return None
    return _serialize(session)


def conclude_session(session_id: str) -> dict:
    """结束会商，生成总结。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}

    session['phase'] = 'concluded'

    # 尝试用 LLM 生成总结
    summary = _llm_summarize(session)
    if not summary:
        # 降级到简单统计
        node_msgs = [m for m in session['messages'] if m['type'] == 'node']
        by_name = {}
        for m in node_msgs:
            name = m.get('node_name', '?')
            by_name[name] = by_name.get(name, 0) + 1
        parts = [f"{n}发言{c}次" for n, c in by_name.items()]
        summary = f"历经{session['round']}轮会商，{'、'.join(parts)}。相关结论待继续落地。"

    session['messages'].append({
        'type': 'system',
        'content': f'📋 节点会商结束 —— {summary}',
        'timestamp': time.time(),
    })
    session['summary'] = summary

    return {
        'ok': True,
        'session_id': session_id,
        'summary': summary,
    }


def list_sessions() -> list[dict]:
    """列出所有活跃会话。"""
    return [
        {
            'session_id': s['session_id'],
            'topic': s['topic'],
            'round': s['round'],
            'phase': s['phase'],
            'node_count': len(s['nodes']),
            'message_count': len(s['messages']),
        }
        for s in _sessions.values()
    ]


def destroy_session(session_id: str):
    _sessions.pop(session_id, None)


def get_fate_event() -> str:
    """获取随机命运骰子事件。"""
    import random
    return random.choice(FATE_EVENTS)


# ── LLM 集成 ──

_PREFERRED_MODELS = ['gpt-4o-mini', 'claude-haiku', 'gpt-5-mini', 'gemini-3-flash', 'gemini-flash']

# GitHub Copilot 模型列表 (通过 Copilot Chat API 可用)
_COPILOT_MODELS = [
    'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'claude-haiku-3.5',
    'gemini-2.0-flash', 'o3-mini',
]
_COPILOT_PREFERRED = ['gpt-4o-mini', 'claude-haiku', 'gemini-flash', 'gpt-4o']


def _pick_chat_model(models: list[dict]) -> str | None:
    """从 provider 的模型列表中选一个适合聊天的轻量模型。"""
    ids = [m['id'] for m in models if isinstance(m, dict) and 'id' in m]
    for pref in _PREFERRED_MODELS:
        for mid in ids:
            if pref in mid:
                return mid
    return ids[0] if ids else None


def _read_copilot_token() -> str | None:
    """读取 openclaw 管理的 GitHub Copilot token。"""
    token_path = os.path.expanduser('~/.openclaw/credentials/github-copilot.token.json')
    if not os.path.exists(token_path):
        return None
    try:
        with open(token_path) as f:
            cred = json.load(f)
        token = cred.get('token', '')
        expires = cred.get('expiresAt', 0)
        # 检查 token 是否过期（毫秒时间戳）
        import time
        if expires and time.time() * 1000 > expires:
            logger.warning('Copilot token expired')
            return None
        return token if token else None
    except Exception as e:
        logger.warning('Failed to read copilot token: %s', e)
        return None


def _get_llm_config() -> dict | None:
    """从 openclaw 配置读取 LLM 设置，支持环境变量覆盖。

    优先级: 环境变量 > github-copilot token > 本地 copilot-proxy > anthropic > 其他 provider
    """
    # 1. 环境变量覆盖
    env_key = os.environ.get('OPENCLAW_LLM_API_KEY', '')
    if env_key:
        return {
            'api_key': env_key,
            'base_url': os.environ.get('OPENCLAW_LLM_BASE_URL', 'https://api.openai.com/v1'),
            'model': os.environ.get('OPENCLAW_LLM_MODEL', 'gpt-4o-mini'),
            'api_type': 'openai',
        }

    # 2. GitHub Copilot token（最优先 — 免费、稳定、无需额外配置）
    copilot_token = _read_copilot_token()
    if copilot_token:
        # 选一个 copilot 支持的模型
        model = 'gpt-4o'
        logger.info('Bridge discuss using github-copilot token, model=%s', model)
        return {
            'api_key': copilot_token,
            'base_url': 'https://api.githubcopilot.com',
            'model': model,
            'api_type': 'github-copilot',
        }

    # 3. 从 ~/.openclaw/openclaw.json 读取其他 provider 配置
    openclaw_cfg = os.path.expanduser('~/.openclaw/openclaw.json')
    if not os.path.exists(openclaw_cfg):
        return None

    try:
        with open(openclaw_cfg) as f:
            cfg = json.load(f)

        providers = cfg.get('models', {}).get('providers', {})

        # 按优先级排序：copilot-proxy > anthropic > 其他
        ordered = []
        for preferred in ['copilot-proxy', 'anthropic']:
            if preferred in providers:
                ordered.append(preferred)
        ordered.extend(k for k in providers if k not in ordered)

        for name in ordered:
            prov = providers.get(name)
            if not prov:
                continue
            api_type = prov.get('api', '')
            base_url = prov.get('baseUrl', '')
            api_key = prov.get('apiKey', '')
            if not base_url:
                continue

            # 跳过无 key 且非本地的 provider
            if not api_key or api_key == 'n/a':
                if 'localhost' not in base_url and '127.0.0.1' not in base_url:
                    continue

            model_id = _pick_chat_model(prov.get('models', []))
            if not model_id:
                continue

            # 本地代理先探测是否可用
            if 'localhost' in base_url or '127.0.0.1' in base_url:
                try:
                    import urllib.request
                    probe = urllib.request.Request(base_url.rstrip('/') + '/models', method='GET')
                    urllib.request.urlopen(probe, timeout=2)
                except Exception:
                    logger.info('Skipping provider=%s (not reachable)', name)
                    continue

            logger.info('Bridge discuss using openclaw provider=%s model=%s api=%s', name, model_id, api_type)
            send_auth = prov.get('authHeader', True) is not False and api_key not in ('', 'n/a')
            return {
                'api_key': api_key if send_auth else '',
                'base_url': base_url,
                'model': model_id,
                'api_type': api_type,
            }
    except Exception as e:
        logger.warning('Failed to read openclaw config: %s', e)

    return None


def _llm_complete(system_prompt: str, user_prompt: str, max_tokens: int = 1024) -> str | None:
    """调用 LLM API（自动适配 GitHub Copilot / OpenAI / Anthropic 协议）。"""
    config = _get_llm_config()
    if not config:
        return None

    import urllib.request
    import urllib.error

    api_type = config.get('api_type', 'openai-completions')

    if api_type == 'anthropic-messages':
        # Anthropic Messages API
        url = config['base_url'].rstrip('/') + '/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': config['api_key'],
            'anthropic-version': '2023-06-01',
        }
        payload = json.dumps({
            'model': config['model'],
            'system': system_prompt,
            'messages': [{'role': 'user', 'content': user_prompt}],
            'max_tokens': max_tokens,
            'temperature': 0.9,
        }).encode()
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data['content'][0]['text']
        except Exception as e:
            logger.warning('Anthropic LLM call failed: %s', e)
            return None
    else:
        # OpenAI-compatible API (也适用于 github-copilot)
        if api_type == 'github-copilot':
            url = config['base_url'].rstrip('/') + '/chat/completions'
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {config['api_key']}",
                'Editor-Version': 'vscode/1.96.0',
                'Copilot-Integration-Id': 'vscode-chat',
            }
        else:
            url = config['base_url'].rstrip('/') + '/chat/completions'
            headers = {'Content-Type': 'application/json'}
            if config.get('api_key'):
                headers['Authorization'] = f"Bearer {config['api_key']}"
        payload = json.dumps({
            'model': config['model'],
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'max_tokens': max_tokens,
            'temperature': 0.9,
        }).encode()
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data['choices'][0]['message']['content']
        except Exception as e:
            logger.warning('LLM call failed: %s', e)
            return None


def _llm_discuss(session: dict, user_message: str = None, system_event: str = None) -> dict | None:
    """使用 LLM 生成多节点讨论。"""
    nodes = session['nodes']
    names = '、'.join(o['name'] for o in nodes)

    profiles = ''
    for o in nodes:
        profiles += f"\n### {o['name']}（{o['role']}）\n"
        profiles += f"职责范围：{o.get('duty', '综合事务')}\n"
        profiles += f"性格：{o['personality']}\n"
        profiles += f"说话风格：{o['speaking_style']}\n"

    # 构建最近的对话历史
    history = ''
    for msg in session['messages'][-20:]:
        if msg['type'] == 'system':
            history += f"\n【系统】{msg['content']}\n"
        elif msg['type'] == 'owner':
            history += f"\n主人：{msg['content']}\n"
        elif msg['type'] == 'system_event':
            history += f"\n【系统事件】{msg['content']}\n"
        elif msg['type'] == 'node':
            history += f"\n{msg.get('node_name', '?')}：{msg['content']}\n"
        elif msg['type'] == 'scene_note':
            history += f"\n（{msg['content']}）\n"

    if user_message:
        history += f"\n主人：{user_message}\n"
    if system_event:
        history += f"\n【系统事件——全局视角干预】{system_event}\n"

    system_event_section = ''
    if system_event:
        system_event_section = '\n请根据系统事件调整讨论走向，所有节点都必须对此做出反应。\n'

    prompt = f"""你是一个太空舰载系统多节点会商模拟器。模拟多位节点围绕议题展开讨论。

## 参与节点
{names}

## 节点设定（每个节点都有明确职责，必须从自身专业角度出发讨论）
{profiles}

## 当前议题
{session['topic']}

## 对话记录
{history if history else '（讨论刚刚开始）'}
{system_event_section}
## 任务
生成每位节点的下一条发言。要求：
1. 每位节点说1-3句话，像真实舰桥会商一样
2. **每位节点必须从自己的职责领域出发发言**——源流谈成本和数据、维控谈安全和运维、机务谈技术实现、探针谈质量和合规、文枢谈文档和规范、序列谈编组安排、星枢谈规划方案、棱镜谈校核风险、中继谈执行调度、云霄谈输入分拣和整体节奏，每个节点关注的焦点不同
3. 节点之间要有互动——回应、反驳、支持、补充，尤其是不同模块视角的碰撞
4. 保持每位节点独特的说话风格和人格特征
5. 讨论要围绕议题推进、有实质性观点，不要泛泛而谈
6. 如果主人发言了，节点要恰当回应（但不要献媚）
7. 可包含动作描写用*号*包裹（如 *切换观测屏*）

输出JSON格式：
{{
  "messages": [
    {{"node_id": "xingshu", "name": "星枢", "content": "发言内容", "emotion": "neutral|confident|worried|angry|thinking|amused", "action": "可选动作描写"}},
    ...
  ],
  "scene_note": "可选的舰桥氛围变化（如：舰桥警示灯闪烁|观测屏同步刷新），没有则为null"
}}

只输出JSON，不要其他内容。"""

    content = _llm_complete(
        '你是一个舰桥多节点群聊模拟器，严格输出JSON格式。',
        prompt,
        max_tokens=1500,
    )

    if not content:
        return None

    # 解析 JSON
    if '```json' in content:
        content = content.split('```json')[1].split('```')[0].strip()
    elif '```' in content:
        content = content.split('```')[1].split('```')[0].strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.warning('Failed to parse LLM response: %s', content[:200])
        return None


def _llm_summarize(session: dict) -> str | None:
    """用 LLM 总结会商结果。"""
    node_msgs = [m for m in session['messages'] if m['type'] == 'node']
    topic = session['topic']

    if not node_msgs:
        return None

    dialogue = '\n'.join(
        f"{m.get('node_name', '?')}：{m['content']}"
        for m in node_msgs[-30:]
    )

    prompt = f"""以下是舰桥节点围绕「{topic}」的讨论记录：

{dialogue}

请用2-3句话总结讨论结果、达成的共识和待决事项。风格要像舰载系统值班纪要，简洁、清晰、可执行。"""

    return _llm_complete('你是舰桥记录模块，负责总结会商结果。', prompt, max_tokens=300)


# ── 规则模拟（无 LLM 时的降级方案）──

_SIMULATED_RESPONSES = {
    'xingshu': [
        '我建议从全局拆成三段：先确认输入边界，再形成执行方案，最后交给执行节点并行落地。',
        '当前最合适的是先整理一份结构化方案，送棱镜校核后再交中继路由。',
        '*展开流程图* 我已经形成初步执行路径，待棱镜校核后即可进入下一阶段。',
    ],
    'lengjing': [
        '我先指出几个风险点：当前方案的边界条件和资源约束还不够完整。',
        '直说结论，这份方案缺少关键校核项，尤其是回滚与验收路径。',
        '*放大风险面板* 这个时间线偏乐观，建议补齐校核条件后再放行。',
    ],
    'zhongji': [
        '只要方案通过，我会立刻拆出执行路由，机务主导实现，维控负责稳态保障。',
        '从执行角度看，这件事应由机务牵头，源流补数据，探针补校验。',
        '路由交给我，我会按模块职责把子任务分发到位。',
    ],
    'main': [
        '我先给结论：这个方向值得推进，但要先把输入范围压实，再决定执行节奏。',
        '当前争论的核心不是要不要做，而是先做哪一块最能验证价值。',
        '方向没问题，请各模块先评估各自落地难点，再回到舰桥统一收口。',
    ],
    'yuanliu': [
        '我先看资源面，按当前 token 与算力消耗，这个投入需要重新测算。',
        '从成本曲线看，更稳妥的是分阶段投入，先做最小验证，再扩大资源。',
        '*调出资源面板* 现有资源能支撑启动，但必须严格卡住预算上限。',
    ],
    'weikong': [
        '我会先盯稳定性和回滚链路，任何上线动作都要保证可快速止损。',
        '运维侧的底线是部署、监控、日志和告警必须先补齐。',
        '可以快，但不能失控，权限收口和漏洞扫描必须同步推进。',
    ],
    'tanzhen': [
        '这件事要先过质量门槛，代码审查、测试覆盖和敏感信息排查都不能省。',
        '我建议把测试验收前置，不能因为赶工就把质量阈值降下来。',
        '*切出校验清单* 边界条件、异常处理和日志规范都必须过审。',
    ],
    'jiwu': [
        '从技术架构看，这条路径可行，但要先把模块边界和扩展点设计清楚。',
        '我可以先起一个原型，把关键假设尽快验证掉，再迭代细节。',
        '*调出接口草图* 先统一 API 和数据结构，后续实现会顺很多。',
    ],
    'wenshu': [
        '我建议先整理一份正式说明，明确职责分界、验收标准和输出格式。',
        '这项会商需要同步留痕，我来负责方案文档和对外表述的一致性。',
        '*打开文档模板* 已记录关键结论，稍后会整理成标准交付说明。',
    ],
    'xulie': [
        '这件事的关键在编组方式，需要先看各模块负载和能力基线。',
        '目前各模块压力不均，我建议调整协作规范，确保关键节点有人盯住节奏。',
        '我可以协调编组和能力补位，避免关键链路出现单点风险。',
    ],
}

import random


def _simulated_discuss(session: dict, user_message: str = None, system_event: str = None) -> list[dict]:
    """无 LLM 时的规则生成讨论内容。"""
    nodes = session['nodes']
    messages = []

    for o in nodes:
        oid = o['id']
        pool = _SIMULATED_RESPONSES.get(oid, [])
        if isinstance(pool, set):
            pool = list(pool)
        if not pool:
            pool = ['臣附议。', '臣有不同看法。', '臣需要再想想。']

        content = random.choice(pool)
        emotions = ['neutral', 'confident', 'thinking', 'amused', 'worried']

        # 如果皇帝发言了或有天命降临，调整回应
        if system_event:
            content = f'*面露惊色* 天命如此，{content}'
        elif user_message:
            content = f'回报主人，{content}'

        messages.append({
            'node_id': oid,
            'name': o['name'],
            'content': content,
            'emotion': random.choice(emotions),
            'action': None,
        })

    return messages


def _serialize(session: dict) -> dict:
    return {
        'ok': True,
        'session_id': session['session_id'],
        'topic': session['topic'],
        'task_id': session.get('task_id', ''),
        'nodes': session['nodes'],
        'messages': session['messages'],
        'round': session['round'],
        'phase': session['phase'],
    }
