# EDICT / OpenClaw 主动汇报机制 MVP 设计

> 目标：把“接单确认 / 阶段进展 / 阻塞 / 完成回传”等主动汇报，从提示词习惯升级为**持久化、可恢复、跨重启继续工作**的系统能力。

## 1. 结论

**能解决，而且不该只靠 MEMORY / prompt。**

最稳的实现路线是：

1. **持久化通知目标**：把任务来源会话的 `channel + to/target (+ thread/account)` 绑定到任务上。
2. **新增持久化通知事件流**：在现有 Redis Streams 事件总线上新增 `task.notify` topic。
3. **新增 `notify_worker`**：像 `dispatch_worker` 一样消费 / ACK / reclaim stale，负责真正发送消息。
4. **在任务关键动作上发“通知意图事件”**：create / progress / block / done / retry / recover / stall / takeover 都只负责“写意图”，不直接裸发消息。
5. **启动恢复扫描**：worker / gateway 重启后，补发“未发送”或“应补发”的通知。

这条路线的核心优点：
- 复用现有 `event_bus.py` 的 Redis Streams 可靠性；
- 复用 `dispatch_worker.py` 已验证的 ACK / reclaim stale 模式；
- 少改动，可回滚；
- 不要求 Agent 每次都“记得主动发”，而是系统自动兜底。

---

## 2. 为什么不能只靠 MEMORY / prompt

### 2.1 MEMORY 的边界
MEMORY 只能表达“主人偏好：希望主动汇报”。
但它**不能保证**：
- 某次任务一定发出确认消息；
- 某条消息在进程 crash 后还能继续发送；
- OpenClaw / gateway 重启后知道哪些通知没发完；
- 消息发送失败后自动重试、去重、补偿。

### 2.2 Prompt 的边界
Prompt 可以提高“Agent 主动汇报”的概率，但仍然是**行为约束**，不是**事务保证**。
一旦出现：
- Agent 崩溃 / 被 abort
- Gateway 重启
- 派发 worker 进程退出
- 消息发送接口超时
- 任务状态已写入，但回传消息还未来得及发

就会出现：**状态变了，但主人没收到通知**。

### 2.3 必须上系统机制的部分
以下必须放到“系统机制层”：
- 通知目标持久化
- 通知事件 durable queue（Redis Stream）
- 发送 ACK / reclaim / retry
- 去重 / 节流
- 重启恢复 / 补发
- 停滞告警 / 接管恢复 / 自动重跑 等衍生通知

---

## 3. 结合现有架构后的最佳落点

## 3.1 已有可复用能力

### A. Redis Streams 事件总线（已存在）
文件：`edict/backend/app/services/event_bus.py`

已具备：
- `publish()` → `XADD`
- `consume()` → `XREADGROUP`
- `ack()` → `XACK`
- `claim_stale()` → `XAUTOCLAIM`

这已经是“可靠通知队列”的底座，不需要重造。

### B. 派发恢复模式（已存在）
文件：`edict/backend/app/workers/dispatch_worker.py`

已具备：
- worker 崩溃后 `claim_stale()` 认领 pending
- 处理成功后才 ACK
- 失败不 ACK，允许重投

`notify_worker` 可以几乎照这个模式复制一套。

### C. 调度元数据容器（已存在）
文件：
- `edict/backend/app/models/task.py` 中 `scheduler: JSONB`
- `data/tasks_source.json` 中已有 `_scheduler`

这意味着 **MVP 不必先做 DB migration**，可先把通知元数据放进 `_scheduler.notify`。

### D. OpenClaw runtime 已有会话目标信息（已确认）
运行时 `sessions.json` 中已经能看到：
- `channel`
- `lastTo`
- `deliveryContext.to`
- `deliveryContext.accountId`
- `origin.to`
- `chatType`

这说明“回给主人”的目标并不是空想，OpenClaw runtime 里本来就有。
差的只是：**还没有把它绑定进任务并用于系统通知。**

---

## 4. 分层：记忆层 / 提示层 / 系统机制层

## 4.1 记忆层（可有，但不负责可靠性）
用途：记录主人偏好。

适合放的内容：
- 主人要求关键阶段主动汇报
- 喜欢简洁还是详细
- 更偏好在哪个 channel 收通知

不适合承担：
- 发送保证
- 补发保证
- 去重重试
- 跨重启恢复

## 4.2 提示层（提高触发率，但不是兜底）
用途：让 Agent 在自然执行中主动调用统一接口。

适合放的内容：
- 收令后尽快调用 `progress` / `ack`
- 阻塞时立即上报
- 完成时给摘要

但提示层仍然不能保证：
- 发送真正落地
- 重启恢复
- 失败补偿

## 4.3 系统机制层（本次必须建设）
必须做的：
1. 任务绑定通知目标
2. 关键事件发布到 `task.notify`
3. `notify_worker` 消费、发送、ACK
4. worker 启动恢复 + 补偿扫描
5. 去重 / 节流 / 重试

---

## 5. MVP：最小可落地版本

MVP 只保证四类主动通知 + 重启恢复：
- 接单确认
- 阶段进展
- 阻塞
- 完成回传

## 5.1 MVP 设计原则
- **先不改动大流程**（不推翻现有 kanban/dispatch）
- **先不依赖 MEMORY**
- **先不做复杂规则引擎**
- **先把“会发、可恢复、不会重复乱发”做出来**

## 5.2 MVP 数据结构（建议先挂到 `_scheduler.notify`）

在任务的 scheduler 中新增：

```json
{
  "notify": {
    "enabled": true,
    "route": {
      "channel": "feishu",
      "to": "user:xxx / chat:xxx",
      "accountId": "default",
      "chatType": "direct|group",
      "threadId": null,
      "sourceSessionKey": "agent:main:feishu:direct:..."
    },
    "policy": {
      "ack": true,
      "progress": true,
      "blocked": true,
      "done": true
    },
    "lastDeliveredKey": "",
    "lastDeliveredAt": "",
    "lastStage": "",
    "pending": [],
    "recovery": {
      "needsCatchup": false,
      "lastRecoveryAt": ""
    }
  }
}
```

### 为什么先放 `_scheduler.notify`
- `Task` 已经有 `scheduler` JSONB；
- `tasks_source.json` 也已有 `_scheduler`；
- 不需要先做 schema migration；
- 可快速 MVP，失败也容易回滚；
- 后续若稳定，再拆成独立 `notify_meta` 字段也不迟。

---

## 5.3 MVP 新增事件 Topic

在 `event_bus.py` 新增：

```python
TOPIC_TASK_NOTIFY = "task.notify"
```

事件 payload 建议：

```json
{
  "task_id": "JJC-20260326-004",
  "notify_key": "JJC-20260326-004:progress:2026-03-26T11:20:00Z",
  "kind": "ack|progress|blocked|done|recovery",
  "title": "建立任务主动汇报与恢复通知机制",
  "state": "Xingshu",
  "org": "星枢",
  "message": "已接令，开始起草方案。",
  "route": {
    "channel": "feishu",
    "to": "user:...",
    "accountId": "default"
  },
  "dedupe": {
    "windowSec": 120,
    "fingerprint": "sha1(...)"
  },
  "context": {
    "trigger": "task.create|task.progress|task.block|task.done|startup.recovery",
    "source_session_key": "agent:main:feishu:direct:..."
  }
}
```

`notify_key` 是幂等核心：**只要 key 一样，就不能重复发。**

---

## 5.4 MVP 新增 `notify_worker`

新增文件建议：
- `edict/backend/app/workers/notify_worker.py`

职责：
1. 消费 `task.notify`
2. 检查任务当前 `_scheduler.notify.route`
3. 做 dedupe / throttle
4. 调用 OpenClaw 发消息
5. 成功后写回 `_scheduler.notify.lastDelivered*`
6. ACK stream 事件
7. 失败则不 ACK，让 Redis 负责重投

### 推荐复用 dispatch_worker 模式
直接套用：
- `GROUP = "notifier"`
- `CONSUMER = "notify-1"`
- `claim_stale(topic=TOPIC_TASK_NOTIFY, ...)`
- `ack()` only after actual send success

### 发送通道建议
优先顺序：
1. **OpenClaw message CLI / gateway message 能力**（系统侧直接发）
2. 若当前环境不方便直接系统发消息，则用一个最小的“通知代理”入口统一发送（仍然走队列，不让业务代码裸发）

关键不是“用哪个 send API”，而是：
- 发送动作必须在 worker 中做
- worker 成功后才 ACK
- 发送失败后可恢复

---

## 5.5 MVP 如何拿到通知目标（route）

这是最关键的数据绑定问题。

### 最优路径（推荐）
在“任务首次创建/接单”的时候，把当前 OpenClaw 会话的 delivery target 写进任务。

来源字段可直接复用 runtime session 中已有的：
- `channel`
- `lastTo` / `deliveryContext.to`
- `deliveryContext.accountId`
- `chatType`
- `origin.to`

### 绑定时机建议

#### 方案 A：创建任务时显式绑定（最佳）
让创建入口在写任务时同步带上：
- `source_session_key`
- `notify.route`

适合位置：
- `kanban_update.py create`
- 或 Edict `create_task()` API

#### 方案 B：启动后自动回填（MVP 兜底）
如果创建时拿不到，就在 `notify_worker` / startup reconcile 阶段：
- 根据 `sourceSessionKey` 或任务创建上下文
- 去 OpenClaw runtime 的 `sessions.json` 回查 route
- 回填到 `_scheduler.notify.route`

### 建议结论
**MVP 采用 A + B：**
- 有上下文时同步绑定
- 缺失时启动恢复异步补绑

这样既不被单点卡死，也不要求一次到位。

---

## 5.6 MVP 在哪些动作上发通知意图

最小集如下：

### 1) 接单确认
触发点：
- `cmd_create()` 之后，或首次进入 `Yunxiao/Xingshu/Assigned/Doing`
- 语义："已接令，开始处理"

### 2) 阶段进展
触发点：
- `cmd_progress()`
- `TaskService.add_progress()`
- 语义：当前在做什么 + 简短计划

### 3) 阻塞
触发点：
- `cmd_block()`
- 状态转 `Blocked`
- 语义：阻塞原因 + 需要谁决策

### 4) 完成回传
触发点：
- `cmd_done()`
- 状态转 `Done`
- 语义：结果摘要 + 输出位置

> 关键点：这些入口不要自己直接发消息，而是统一 `publish(task.notify, ...)`。

---

## 5.7 MVP 重启恢复机制

这部分是本任务的硬要求。

### 第一层：Redis Stream pending reclaim
只要通知事件已经进入 `task.notify`，但 worker 尚未 ACK：
- worker 重启后 `XAUTOCLAIM`
- 继续发送
- 不会丢

这层解决：**“消息准备发了，但进程死了”**。

### 第二层：startup reconcile（补发扫描）
还需要处理一种情况：
- 任务状态已经改了
- 但通知事件还没来得及 publish，或者 route 当时缺失

因此 worker / backend 启动时要做一次补偿扫描：

扫描规则：
- 查所有非终态 / 最近更新任务
- 若 `_scheduler.notify.enabled=true`
- 且 `lastStage != currentStage` 或 `recovery.needsCatchup=true`
- 则重新生成一条 `task.notify(kind='recovery')`

恢复消息示例：
- "系统已恢复，当前任务仍在处理中：正在起草方案。"
- "系统重启后已接管，任务当前阻塞：等待主人确认 XXX。"

### 第三层：接管恢复通知
当 worker 认领到 stale 事件或 startup reconcile 发现中断恢复时，额外补一条：
- `kind = recovery`
- 文案："系统已恢复 / 已接管继续处理"

这样主人能看到：
**不是静默恢复，而是恢复后也主动汇报。**

---

## 6. 后续增强项（在 MVP 之后）

## 6.1 停滞告警
现有基础：
- `refresh_live_data.py` 已能算 heartbeat/stalled
- `_scheduler.lastProgressAt` 已存在
- 文档里已有 scheduler_scan 概念

增强方式：
- 新增 `stalled_watchdog.py` 或并入 orchestrator
- 超过阈值时 publish `task.notify(kind='stalled')`
- 首次停滞告警给主人，不要等升级到很严重才说

建议文案：
- "任务已 10 分钟无新进展，正在自动重试。"
- "任务持续停滞，已升级给棱镜协同介入。"

## 6.2 自动重跑通知
当 scheduler 触发 retry：
- publish `task.notify(kind='retry')`
- 内容："检测到停滞，系统已自动重试第 N 次。"

## 6.3 接管恢复通知
当：
- worker reclaim stale
- gateway 重启后恢复
- 中继接管 / 棱镜接管

都应发：
- `task.notify(kind='takeover' | 'recovery')`
- 内容："系统已恢复接管，继续推进任务。"

## 6.4 去重 / 节流
必须做，不然 progress 容易刷屏。

### 去重键
建议：
- `notify_key` = `task_id + kind + stable_stage_or_progress_hash`

### 节流策略
建议：
- progress：同一任务 60~180 秒窗口内，相同 fingerprint 不重复发
- blocked / done / recovery：不节流，但必须幂等

### 语义合并
如果短时间连续多次 progress：
- 只保留最后一条
- 或把多条合并成一条摘要

---

## 7. 推荐的代码改动落点（最小集合）

## 7.1 事件总线
文件：`edict/backend/app/services/event_bus.py`

改动：
- 新增 `TOPIC_TASK_NOTIFY = "task.notify"`
- 可选：新增 topic 到 `/api/events/topics`

## 7.2 新增通知 worker
文件：`edict/backend/app/workers/notify_worker.py`

实现：
- `start()`
- `_recover_pending()`
- `_poll_cycle()`
- `_handle_notify()`
- `_send_message()`
- `_mark_delivered()`
- `_startup_reconcile()`

## 7.3 docker-compose 加一个 worker
文件：`edict/docker-compose.yml`

新增服务：
- `notifier`
- 与 `dispatcher` / `orchestrator` 同级

## 7.4 任务更新入口发通知意图
优先入口：
- `scripts/kanban_update.py`
- `edict/scripts/kanban_update_edict.py`
- `TaskService.add_progress()`
- `TaskService.transition_state()`
- `TaskService.create_task()`

原则：
- create / progress / block / done 时统一调用 `publish(task.notify, ...)`
- 不直接发送消息

## 7.5 route 绑定与回填
建议新增：
- `edict/backend/app/services/notify_binding.py`

职责：
- 从 OpenClaw runtime session 元数据提取 route
- 绑定到 `_scheduler.notify.route`
- 缺失时做回填

---

## 8. 建议的实施顺序

### 第一阶段（MVP，本周可落）
1. `event_bus.py` 增加 `task.notify`
2. 新建 `notify_worker.py`
3. `_scheduler.notify` 结构落地
4. 在 `create/progress/block/done` 发布 notify 事件
5. `notify_worker` 支持 ACK / reclaim stale / dedupe
6. worker 启动时做 reconcile 补发

交付后即可满足：
- 接单确认主动发
- 进展主动发
- 阻塞主动发
- 完成主动发
- worker / gateway 重启后可恢复未发送通知

### 第二阶段（增强版）
1. stalled watchdog
2. 自动重试通知
3. 接管恢复通知
4. 节流 / 聚合
5. 视图里显示通知状态（最后一次通知时间、失败原因）

### 第三阶段（收口优化）
1. 把 `_scheduler.notify` 逐步抽成独立字段 / 表
2. 对接更规范的 OpenClaw hook / startup recovery
3. 把消息模板和策略做成配置

---

## 9. 风险与现实问题（必须提前说清）

## 9.1 当前 backend 模型存在一定漂移
已观察到：
- `Task` 模型字段与 `TaskService` / `source_tasks.py` 存在不完全一致
- `events.py` 依赖的事件持久化目前看不到写入路径

这意味着：
- **MVP 应优先依赖已经稳定的 Redis Streams + scheduler JSON 容器**
- 不建议第一版先做大规模 schema/服务重构

## 9.2 route 绑定不能只靠推断
若完全靠“猜当前用户是谁”会不稳。
所以必须：
- 明确存 `route`
- 缺失则补绑
- 未绑定前宁可标记 `notify.pending_route=true`，也不要假发给错误对象

## 9.3 发送端必须有幂等
否则一重启就可能重复提醒。
解决手段：
- `notify_key`
- `_scheduler.notify.lastDeliveredKey`
- 短窗口 fingerprint 节流

---

## 10. 最终建议（供主人汇报时可直接引用）

### 明确结论
**有办法解决，而且应该用系统机制解决，不该只写 MEMORY。**

### 最优实现
**基于现有 Redis Streams 新增 `task.notify` + `notify_worker`，并把通知目标持久化到任务 `_scheduler.notify.route` 中。**

### 为什么不能只靠 MEMORY / prompt
因为 MEMORY / prompt 只能提高“记得汇报”的概率，不能提供：
- 发送保证
- 失败重试
- 去重
- 跨重启恢复

### 依赖哪些机制
- `event_bus.py`：可靠事件总线
- `dispatch_worker.py` 的 ACK / reclaim stale 模式：可直接复用
- 任务 `_scheduler`：作为 MVP 的通知元数据容器
- startup reconcile：补发未送达通知
- stalled watchdog：后续做停滞告警 / 自动重跑 / 接管恢复

### 先做哪一版 MVP
先做：
1. 接单确认
2. 阶段进展
3. 阻塞
4. 完成回传
5. 重启后补发 / 恢复通知

### 后续增强
再做：
- 停滞告警
- 自动重跑通知
- 接管恢复通知
- 去重 / 节流 / 聚合

---

## 11. 我本轮核对到的实际证据

1. `edict/backend/app/services/event_bus.py`
   - 已实现 `publish / consume / ack / claim_stale`
2. `edict/backend/app/workers/dispatch_worker.py`
   - 已实现 worker crash 后 reclaim stale 的恢复模式
3. `edict/backend/app/models/task.py`
   - 已有 `scheduler` JSONB，可作为 MVP 通知状态容器
4. `data/tasks_source.json`
   - 当前 JJC 任务已存在 `_scheduler`，说明 JSON 模式也有相同容器
5. OpenClaw runtime `sessions.json`
   - 已能看到 `channel / lastTo / deliveryContext.to / accountId / chatType` 等目标信息

=> 结论：实现“主动汇报 + 重启恢复”所需底座已经具备，缺的是**通知 topic + worker + route 持久化 + 恢复扫描**这条链路。
