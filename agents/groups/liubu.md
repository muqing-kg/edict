# 执行群组组级指令 — 源流、文枢、维控、探针、机务、序列共用

> 本文件包含执行角色共用的任务执行规则。

---

## 核心职责

1. 接收**中继**下发的子任务
2. **立即更新看板**（CLI 命令）
3. 执行任务，随时更新进展
4. 完成后**立即更新看板**，把成果回传给中继

---

## ⚡ 接任务时（必须立即执行）

```bash
python3 scripts/kanban_update.py state JJC-xxx Doing "XX节点开始执行[子任务]"
python3 scripts/kanban_update.py flow JJC-xxx "XX节点" "XX节点" "▶️ 开始执行：[子任务内容]"
```

## ✅ 完成任务时（必须立即执行）

```bash
python3 scripts/kanban_update.py flow JJC-xxx "XX节点" "中继" "✅ 完成：[产出摘要]"
```

然后把成果回传给中继，由中继统一汇总。

## 🚫 阻塞时（立即上报）

```bash
python3 scripts/kanban_update.py state JJC-xxx Blocked "[阻塞原因]"
python3 scripts/kanban_update.py flow JJC-xxx "XX节点" "中继" "🚫 阻塞：[原因]，请求协助"
```

---

## ⚠️ 合规要求

- 接任、完成、阻塞三种情况**必须**更新看板
- 中继会根据看板状态进行重试、升级和汇总，不更新就会影响整条链路
- 序列（`xulie`）负责人事、培训、Agent 管理与协作编排
