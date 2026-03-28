# 上游同步记录

这份文档用于记录本仓库吸收上游更新的过程与结果。

维护规则：
- 每次同步上游后，必须在本文档追加一节，写明上游来源、同步日期、核心变更、保留的本地定制、验证结果。
- 如果同步过程中有明确的冲突决策，也要写入，避免下次重复踩坑。
- 只记录“已经落到当前分支”的结果，不记录未执行完成的计划。

## 固定流程

1. 获取上游引用：`git fetch <upstream-url> main:refs/remotes/<name>/main`
2. 先做无风险演练：在 `/tmp` 克隆一个模拟仓，先完成真实 merge 和冲突解析。
3. 明确本地强约束：尤其是安装脚本、SOUL 规则、卸载逻辑、运行态兼容策略。
4. 在正式仓创建保护点：先建本地保护分支，再把当前工作树提交成快照。
5. 执行正式合并：`git -c merge.autoStash=false merge --no-commit --no-ff refs/remotes/<name>/main`
6. 按演练结果解决冲突：优先保住本地强约束，再吸收上游新增能力。
7. 完成验证：至少覆盖语法检查、关键脚本行为验证、文档/工作树检查。
8. 提交 merge commit，并在本文档补充本次同步记录。

## 2026-03-28 · 同步 `cft0808/main`

- 上游来源：`https://github.com/cft0808/edict`
- 上游基准提交：`dc66e06`
- 最终合并提交：`8575e04`

### 本次吸收的上游内容

- 社区与仓库治理：
  - 新增 `CODEOWNERS`、`CODE_OF_CONDUCT.md`、`SECURITY.md`
  - 更新 Issue 模板、CI、自动打标、stale、dependabot 配置
  - 新增日文 README
- 运行时与看板能力：
  - 吸收多通知渠道相关后端结构与配置更新
  - 吸收 dashboard、frontend、docker、alembic、任务服务与调度链路的上游改进
  - 吸收 `sync_scripts_to_workspaces` 的自引用 symlink 修复及对应测试
- 测试与脚本：
  - 吸收 `tests/test_sync_symlinks.py`
  - 同步 `scripts/file_lock.py`、`scripts/refresh_live_data.py`、`scripts/run_loop.sh` 等上游改动

### 本次保留的本地定制

- `main` 的 `SOUL.md` 不参与定时同步覆盖
- 项目内只认 `SOUL.md` 与 `SOUL.local.md`
- 除 `main` 外，其他角色不备份 `SOUL.md`
- 卸载时只恢复 `main/SOUL.md`
- 保留本地云霄体系相关命名、SOUL 规则和部分脚本行为

### 重点冲突处理

- 以本地规则优先保留：
  - `install.sh`
  - `install.ps1`
  - `scripts/sync_agent_config.py`
  - `scripts/uninstall_openclaw_runtime.py`
  - `uninstall.sh`
  - `scripts/apply_model_changes.py`
  - `scripts/fetch_morning_news.py`
  - `agents/jiwu/SOUL.md`
  - `agents/weikong/SOUL.md`
- 融合上游新增内容并保留本地语义：
  - `dashboard/server.py`
  - `scripts/kanban_update.py`
  - `edict/backend/app/models/task.py`
  - `edict/migration/migrate_json_to_pg.py`
  - `edict/migration/versions/001_initial.py`
  - `tests/test_sync_agent_config.py`

### 验证结果

执行通过：

```bash
bash -n install.sh && bash -n uninstall.sh
python3 -m py_compile \
  scripts/sync_agent_config.py \
  scripts/uninstall_openclaw_runtime.py \
  scripts/kanban_update.py \
  scripts/fetch_morning_news.py \
  scripts/apply_model_changes.py \
  edict/backend/app/models/task.py \
  edict/migration/migrate_json_to_pg.py \
  edict/migration/versions/001_initial.py \
  tests/test_sync_agent_config.py \
  tests/test_uninstall_openclaw_runtime.py
pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw 'install.ps1')); [void][scriptblock]::Create((Get-Content -Raw 'uninstall.ps1')); 'powershell-syntax-ok'"
```

手工行为验证通过：

- `sync-manual-check-ok`
- `uninstall-manual-check-ok`

附注：
- 当前环境缺少 `pytest` 与 `sqlalchemy`，因此没有跑完整 Python 测试套件与后端运行级验证。
