<h1 align="center">⚔️ 太空舰载系统 · Edict</h1>

<p align="center">
  <strong>我用一套分层制衡逻辑，重新设计了 AI 多 Agent 协作架构。<br>结果发现，复杂任务真正缺的不是更多 Agent，而是清晰的校核与调度。</strong>
</p>

<p align="center">
  <sub>12 个 AI Agent（11 个业务角色 + 1 个兼容角色）组成太空舰载系统：云霄分拣、星枢规划、棱镜校核、中继路由、执行节点+序列并行执行。<br>比 CrewAI 多一层<b>强制校核</b>，比 AutoGen 多一个<b>实时看板</b>。</sub>
</p>

<p align="center">
  <a href="#-demo">🎬 看 Demo</a> ·
  <a href="#-30-秒快速体验">🚀 30 秒体验</a> ·
  <a href="#-架构">🏛️ 架构</a> ·
  <a href="#-功能全景">📋 看板功能</a> ·
  <a href="docs/task-dispatch-architecture.md">📚 架构文档</a> ·
  <a href="README_EN.md">English</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Required-blue?style=flat-square" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Agents-12_Specialized-8B5CF6?style=flat-square" alt="Agents">
  <img src="https://img.shields.io/badge/Dashboard-Real--time-F59E0B?style=flat-square" alt="Dashboard">
  <img src="https://img.shields.io/badge/License-MIT-22C55E?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/Frontend-React_18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/Backend-stdlib_only-EC4899?style=flat-square" alt="Zero Backend Dependencies">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/公众号-cft0808-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="WeChat">
</p>

---

## 🎬 Demo

<p align="center">
  <video src="docs/Agent_video_Pippit_20260225121727.mp4" width="100%" autoplay muted loop playsinline controls>
    您的浏览器不支持视频播放，请查看下方 GIF 或 <a href="docs/Agent_video_Pippit_20260225121727.mp4">下载视频</a>。
  </video>
  <br>
  <sub>🎥 太空舰载系统 AI 多 Agent 协作全流程演示</sub>
</p>

<details>
<summary>📸 GIF 预览（加载更快）</summary>
<p align="center">
  <img src="docs/demo.gif" alt="太空舰载系统 Demo" width="100%">
  <br>
  <sub>飞书下达指令 → 云霄分拣 → 星枢规划 → 棱镜校核 → 执行节点并行执行 → 任务档案回传（30 秒）</sub>
</p>
</details>

> 🐳 **没有 OpenClaw？** 跑一行 `docker run -p 7891:7891 cft0808/edict` 即可体验完整看板 Demo（预置模拟数据）。

---

## 🤔 为什么是太空舰载系统？

大多数 Multi-Agent 框架的套路是：

> *"来，你们几个 AI 自己聊，聊完把结果给我。"*

然后你拿到一坨不知道经过了什么处理的结果，无法复现，无法审计，无法干预。

**太空舰载系统的思路完全不同** —— 我们用了一个在中国存在 1400 年的制度架构：

```
你 (主人) → 云霄 (分拣) → 星枢 (规划) → 棱镜 (校核) → 中继 (路由) → 执行节点 (执行) → 回传
```

这不是花哨的 metaphor，这是**真正的分权制衡**：

| | CrewAI | MetaGPT | AutoGen | **太空舰载系统** |
|---|:---:|:---:|:---:|:---:|
| **审核机制** | ❌ 无 | ⚠️ 可选 | ⚠️ Human-in-loop | **✅ 棱镜专职校核 · 可打回修订** |
| **实时看板** | ❌ | ❌ | ❌ | **✅ 总控台 Kanban + 时间线** |
| **任务干预** | ❌ | ❌ | ❌ | **✅ 叫停 / 取消 / 恢复** |
| **流转审计** | ⚠️ | ⚠️ | ❌ | **✅ 完整任务档案存档** |
| **Agent 健康监控** | ❌ | ❌ | ❌ | **✅ 心跳 + 活跃度检测** |
| **热切换模型** | ❌ | ❌ | ❌ | **✅ 看板内一键切换 LLM** |
| **技能管理** | ❌ | ❌ | ❌ | **✅ 查看 / 添加 Skills** |
| **新闻聚合推送** | ❌ | ❌ | ❌ | **✅ 天眼简报 + 飞书推送** |
| **部署难度** | 中 | 高 | 中 | **低 · 一键安装 / Docker** |

> **核心差异：制度性审核 + 完全可观测 + 实时可干预**

<details>
<summary><b>🔍 为什么「棱镜校核」是杀手锏？（点击展开）</b></summary>

<br>

CrewAI 和 AutoGen 的 Agent 协作模式是 **"做完就交"**——没有人检查产出质量。就像一个公司没有 QA 部门，工程师写完代码直接上线。

太空舰载系统的 **棱镜** 专门干这件事：

- 📋 **审查方案质量** —— 星枢的规划是否完备？子任务拆解是否合理？
- 🚫 **打回不合格的产出** —— 不是 warning，是直接退回修订
- 🔄 **强制返工循环** —— 直到方案达标才放行

这不是可选的插件，而是**架构的一部分**。每一个指令都必须经过棱镜，没有例外。

这就是为什么太空舰载系统能处理复杂任务而结果可靠：因为在送到执行层之前，有一个强制的质量关卡。

</details>

---

## ✨ 功能全景

### 🏛️ 十二节点 Agent 架构
- **云霄** 消息分拣 —— 闲聊自动回复，指令才建任务
- **核心链路**（云霄·星枢·棱镜·中继）负责分拣、规划、校核与路由
- **执行节点**（源流·文枢·维控·探针·机务·序列 + 天眼）负责专项执行
- 严格的权限矩阵 —— 谁能给谁发消息，白纸黑字
- **状态流转校验** —— kanban_update.py 强制合法转换路径，非法状态跳转被拒绝
- 每个 Agent 独立 Workspace · 独立 Skills · 独立模型
- **指令数据清洗** —— 标题/备注自动剥离文件路径、元数据、无效前缀

### 📋 总控台看板（10 个功能面板）

<table>
<tr><td width="50%">

**📋 指令看板 · Kanban**
- 按状态列展示全部任务
- 节点过滤 + 全文搜索
- 心跳徽章（🟢活跃 🟡停滞 🔴告警）
- 任务详情 + 完整流转链
- 叫停 / 取消 / 恢复操作

</td><td width="50%">

**🔭 节点调度 · Monitor**
- 可视化各状态任务数量
- 节点分布横向条形图
- Agent 健康状态实时卡片

</td></tr>
<tr><td>

**📜 任务档案 · Memorials**
- 已完成指令自动归档为任务档案
- 五阶段时间线：主人→云霄→星枢→棱镜→执行节点→回传
- 一键复制为 Markdown
- 按状态筛选

</td><td>

**📜 指令模板库 · Template Library**
- 9 个预设指令模板
- 分类筛选 · 参数表单 · 预估时间和费用
- 预览指令 → 一键下发

</td></tr>
<tr><td>

**👥 节点总览 · Officials**
- Token 消耗排行榜
- 活跃度 · 完成数 · 会话统计

</td><td>

**📰 天眼简报 · News**
- 每日自动采集科技/财经资讯
- 分类订阅管理 + 飞书推送

</td></tr>
<tr><td>

**⚙️ 模型配置 · Models**
- 每个 Agent 独立切换 LLM
- 应用后自动重启 Gateway（~5秒生效）

</td><td>

**🛠️ 技能配置 · Skills**
- 各节点已安装 Skills 一览
- 查看详情 + 添加新技能

</td></tr>
<tr><td>

**💬 小任务 · Sessions**
- OC-* 会话实时监控
- 来源渠道 · 心跳 · 消息预览

</td><td>

**🎬 舰桥启动 · Ceremony**
- 每日首次打开播放开场动画
- 今日统计 · 3.5秒自动消失

</td></tr>
<tr><td>

**🏛️ 舰桥议程 · Court Discussion**
- 多节点围绕议题展开部门视角讨论
- LLM 驱动的多角色辩论（各部依职责发表专业意见）
- 支持多轮推进 · 总结结论 · 保留讨论记录

</td><td>

</td></tr>
</table>

---

## 🖼️ 截图

### 指令看板
![指令看板](docs/screenshots/01-kanban-main.png)

<details>
<summary>📸 展开查看更多截图</summary>

### 节点调度
![节点调度](docs/screenshots/02-monitor.png)

### 任务流转详情
![任务流转详情](docs/screenshots/03-task-detail.png)

### 模型配置
![模型配置](docs/screenshots/04-model-config.png)

### 技能配置
![技能配置](docs/screenshots/05-skills-config.png)

### 节点总览
![节点总览](docs/screenshots/06-official-overview.png)

### 会话记录
![会话记录](docs/screenshots/07-sessions.png)

### 任务档案归档
![任务档案归档](docs/screenshots/08-memorials.png)

### 指令模板
![指令模板](docs/screenshots/09-templates.png)

### 天眼简报
![天眼简报](docs/screenshots/10-morning-briefing.png)

### 舰桥启动
![舰桥启动](docs/screenshots/11-ceremony.png)

</details>

---

## 🚀 30 秒快速体验

### Docker 一键启动

```bash
docker run -p 7891:7891 cft0808/sansheng-demo
```
打开 http://localhost:7891 即可体验总控台看板。

<details>
<summary><b>⚠️ 遇到 <code>exec format error</code>？（点击展开）</b></summary>

如果你在 **x86/amd64** 机器（如 Ubuntu、WSL2）上看到：
```
exec /usr/local/bin/python3: exec format error
```

这是因为镜像架构不匹配。请使用 `--platform` 参数：
```bash
docker run --platform linux/amd64 -p 7891:7891 cft0808/sansheng-demo
```

或使用 docker-compose（已内置 `platform: linux/amd64`）：
```bash
docker compose up
```

</details>

### 完整安装

#### 前置条件
- [OpenClaw](https://openclaw.ai) 已安装
- Python 3.9+
- macOS / Linux

#### 安装

```bash
git clone https://github.com/cft0808/edict.git
cd edict
chmod +x install.sh && ./install.sh
```

安装脚本自动完成：
- ✅ 创建全量 Agent Workspace（含云霄/序列/天眼，兼容历史 main）
- ✅ 写入各节点 SOUL.md（角色人格 + 工作流规则 + 数据清洗规范）
- ✅ 注册 Agent 及权限矩阵到 `openclaw.json`
- ✅ **符号链接统一数据**（各 Workspace 的 data/scripts → 项目目录，确保数据一致）
- ✅ **设置 Agent 间通信可见性**（`sessions.visibility all`，解决消息不可达问题）
- ✅ **同步 API Key 到所有 Agent**（自动从已配置的 Agent 复制）
- ✅ 构建 React 前端（需 Node.js 18+，如未安装则跳过）
- ✅ 初始化数据目录 + 首次数据同步（含节点统计）
- ✅ 重启 Gateway 使配置生效

> ⚠️ **首次安装**：需先配置 API Key：`openclaw agents add taizi`，然后重新运行 `./install.sh` 同步到所有 Agent。

> ⚠️ **未安装 OpenClaw 时**：`install.sh` / `install.ps1` 不会在本机伪造运行时目录，而是直接提示先完成 OpenClaw 安装与初始化；仓库内的 `agents/<id>/SOUL.md` 仍可先行编辑。

> 💡 **本机长期自定义**：不要直接改 `~/.openclaw/workspace-<id>/SOUL.md`，后续安装/同步会按仓库基线重写。需要长期保留的本机差异，请写到 `~/.openclaw/workspace-<id>/SOUL.local.md`（兼容 `soul.local.md`）；脚本会自动与仓库版合成为最终 `SOUL.md` / `soul.md`。

#### 启动

```bash
# 终端 1：数据刷新循环
bash scripts/run_loop.sh

# 终端 2：看板服务器
python3 dashboard/server.py

# 打开浏览器
open http://127.0.0.1:7891
```

> 💡 **看板即开即用**：`server.py` 内嵌 `dashboard/dashboard.html`，Docker 镜像包含预构建的 React 前端

> 💡 详细教程请看 [Getting Started 指南](docs/getting-started.md)

---

## 🏛️ 架构

```
                           ┌───────────────────────────────────┐
                           │          👑 主人（你）              │
                           │     Feishu · Telegram · Signal     │
                           └─────────────────┬─────────────────┘
                                             │ 下达指令
                           ┌─────────────────▼─────────────────┐
                           │          � 云霄 (taizi)            │
                           │    分拣：闲聊直接回 / 指令建任务      │
                           └─────────────────┬─────────────────┘
                                             │ 转发指令
                           ┌─────────────────▼─────────────────┐
                           │          📜 星枢 (zhongshu)       │
                           │       接令 → 规划 → 拆解子任务       │
                           └─────────────────┬─────────────────┘
                                             │ 提交审核
                           ┌─────────────────▼─────────────────┐
                           │          🔍 棱镜 (menxia)         │
                           │      校核方案 → 通过校核 / 打回修订 🚫 │
                           └─────────────────┬─────────────────┘
                                             │ 通过校核 ✅
                           ┌─────────────────▼─────────────────┐
                           │          📮 中继 (shangshu)       │
                           │      路由任务 → 协调执行节点 → 汇总回传   │
                           └───┬──────┬──────┬──────┬──────┬───┘
                               │      │      │      │      │
                         ┌─────▼┐ ┌───▼───┐ ┌▼─────┐ ┌───▼─┐ ┌▼─────┐
                         │💰 源流│ │📝 文枢│ │⚔️ 维控│ │⚖️ 探针│ │🔧 机务│
                         │ 数据  │ │ 文档  │ │ 工程  │ │ 合规  │ │ 基建  │
                         └──────┘ └──────┘ └──────┘ └─────┘ └──────┘
                                                               ┌──────┐
                                                               │📋 序列│
                                                               │ 人事  │
                                                               └──────┘
```

### 各节点职责

| 节点 | Agent ID | 职责 | 擅长领域 |
|------|----------|------|---------|
| � **云霄** | `taizi` | 消息分拣、需求整理 | 闲聊识别、指令提炼、标题概括 |
| 📜 **星枢** | `zhongshu` | 接令、规划、拆解 | 需求理解、任务分解、方案设计 |
| 🔍 **棱镜** | `menxia` | 校核、把关、打回修订 | 质量评审、风险识别、标准把控 |
| 📮 **中继** | `shangshu` | 路由、协调、汇总 | 任务调度、进度跟踪、结果整合 |
| 💰 **源流** | `hubu` | 数据、资源、核算 | 数据处理、报表生成、成本分析 |
| 📝 **文枢** | `libu` | 文档、规范、报告 | 技术文档、API 文档、规范制定 |
| ⚔️ **维控** | `bingbu` | 执行、安全、巡检 | 功能开发、Bug 修复、代码审查 |
| ⚖️ **探针** | `xingbu` | 合规、审计、校验 | 安全扫描、合规检查、红线管控 |
| 🔧 **机务** | `gongbu` | 工程、部署、工具 | Docker 配置、流水线、自动化 |
| 📋 **序列** | `libu_hr` | 人事、Agent 管理 | Agent 注册、权限维护、培训 |
| 🌅 **天眼** | `zaochao` | 每日天眼、新闻聚合 | 定时播报、数据汇总 |

### 权限矩阵

> 不是想发就能发 —— 真正的分权制衡

| From ↓ \ To → | 云霄 | 星枢 | 棱镜 | 中继 | 源流 | 文枢 | 维控 | 探针 | 机务 | 序列 |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **云霄** | — | ✅ | | | | | | | | |
| **星枢** | ✅ | — | ✅ | ✅ | | | | | | |
| **棱镜** | | ✅ | — | ✅ | | | | | | |
| **中继** | | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **执行节点** | | | | ✅ | | | | | | |

### 任务状态流转

```
主人 → 云霄分拣 → 星枢规划 → 棱镜校核 → 已路由 → 执行中 → 待汇总 → ✅ 已完成
                      ↑          │                              │
                      └── 打回修订 ─┘                  阻塞 Blocked
```

> ⚡ **状态转换受保护**：`kanban_update.py` 内置 `_VALID_TRANSITIONS` 状态机校验，
> 非法跳转（如 Doing→Taizi）会被拒绝并记录日志，确保流程不可绕过。

---

## 📁 项目结构

```
edict/
├── agents/                     # 12 个 Agent 的人格模板
│   ├── taizi/SOUL.md           # 云霄 · 消息分拣（含指令标题规范）
│   ├── zhongshu/SOUL.md        # 星枢 · 规划中枢
│   ├── menxia/SOUL.md          # 棱镜 · 校核节点
│   ├── shangshu/SOUL.md        # 中继 · 执行调度
│   ├── hubu/SOUL.md            # 源流 · 数据资源
│   ├── libu/SOUL.md            # 文枢 · 文档规范
│   ├── bingbu/SOUL.md          # 维控 · 工程实现
│   ├── xingbu/SOUL.md          # 探针 · 合规审计
│   ├── gongbu/SOUL.md          # 机务 · 基础设施
│   ├── libu_hr/                # 序列 · 人事管理
│   └── zaochao/SOUL.md         # 天眼 · 情报枢纽
├── dashboard/
│   ├── dashboard.html          # 总控台看板（单文件 · 零依赖 · ~2500 行）
│   ├── dist/                   # React 前端构建产物（Docker 镜像内包含，本地可选）
│   ├── court_discuss.py        # 舰桥议程（多节点 LLM 讨论引擎）
│   └── server.py               # API 服务器（Python 标准库 · 零依赖 · ~2300 行）
├── scripts/
│   ├── run_loop.sh             # 数据刷新循环（每 15 秒）
│   ├── kanban_update.py        # 看板 CLI（含指令数据清洗 + 标题校验）
│   ├── skill_manager.py        # Skill 管理工具（远程/本地 Skills 添加、更新、移除）
│   ├── sync_from_openclaw_runtime.py
│   ├── sync_agent_config.py
│   ├── sync_officials_stats.py
│   ├── fetch_morning_news.py
│   ├── refresh_live_data.py
│   ├── apply_model_changes.py
│   └── file_lock.py            # 文件锁（防多 Agent 并发写入）
├── tests/
│   └── test_e2e_kanban.py      # 端到端测试（17 个断言）
├── data/                       # 运行时数据（gitignored）
├── docs/
│   ├── task-dispatch-architecture.md  # 📚 详细架构文档：任务分发、流转、调度的完整设计（业务+技术）
│   ├── getting-started.md             # 快速上手指南
│   ├── wechat-article.md              # 微信文章
│   └── screenshots/                   # 功能截图（11 张）
├── install.sh                  # 一键安装脚本
├── CONTRIBUTING.md             # 贡献指南
└── LICENSE                     # MIT License
```

---

## 🎯 使用方法

### 向 AI 下达指令

通过 Feishu / Telegram / Signal 给星枢发消息：

```
给我设计一个用户注册系统，要求：
1. RESTful API（FastAPI）
2. PostgreSQL 数据库
3. JWT 鉴权
4. 完整测试用例
5. 部署文档
```

**然后坐好，看戏：**

1. 📜 星枢接令，规划子任务分配方案
2. 🔍 棱镜校核，通过校核 / 打回修订
3. 📮 中继路由，分发给维控 + 机务 + 文枢
4. ⚔️ 各节点并行执行，进度实时可见
5. 📮 中继汇总结果，回传给你

全程可在**总控台看板**实时监控，随时可以**叫停、取消、恢复**。

### 使用指令模板

> 看板 → 📜 指令模板库 → 选模板 → 填参数 → 下发

9 个预设模板：周报生成 · 代码审查 · API 设计 · 竞品分析 · 数据报告 · 博客文章 · 部署方案 · 邮件文案 · 站会摘要

### 自定义 Agent

- 仓库基线：编辑 `agents/<id>/SOUL.md`，适合准备提交到仓库、需要跟随上游同步的公共规则。
- 本机覆盖：编辑 `~/.openclaw/workspace-<id>/SOUL.local.md`（兼容 `soul.local.md`），适合只保留在当前机器、不想被后续同步覆盖的个人化规则。
- 运行态结果：安装脚本与 `scripts/sync_agent_config.py` 会把两者自动合成为 `~/.openclaw/workspace-<id>/SOUL.md` 和 `soul.md`；如果两者冲突，以本机覆盖层为准。

### 增补 Skills（从网上连接）

**三种方式添加 Skills：**

#### 1️⃣ 看板 UI（最简单）

```
看板 → 🔧 技能配置 → ➕ 添加远程 Skill
→ 输入 Agent + Skill 名称 + GitHub URL
→ 确认 → ✅ 完成
```

#### 2️⃣ CLI 命令（最灵活）

```bash
# 从 GitHub 添加 code_review skill 到星枢
python3 scripts/skill_manager.py add-remote \
  --agent zhongshu \
  --name code_review \
  --source https://raw.githubusercontent.com/openclaw-ai/skills-hub/main/code_review/SKILL.md \
  --description "代码审查技能"

# 一键导入官方 skills 库到指定 agents
python3 scripts/skill_manager.py import-official-hub \
  --agents zhongshu,menxia,shangshu,bingbu,xingbu

# 列出所有已添加的远程 skills
python3 scripts/skill_manager.py list-remote

# 更新某个 skill 到最新版本
python3 scripts/skill_manager.py update-remote \
  --agent zhongshu \
  --name code_review
```

#### 3️⃣ API 请求（自动化集成）

```bash
# 添加远程 skill
curl -X POST http://localhost:7891/api/add-remote-skill \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "zhongshu",
    "skillName": "code_review",
    "sourceUrl": "https://raw.githubusercontent.com/...",
    "description": "代码审查"
  }'

# 查看所有远程 skills
curl http://localhost:7891/api/remote-skills-list
```

**官方 Skills Hub：** https://github.com/openclaw-ai/skills-hub

支持的 Skills：
- `code_review` — 代码审查（Python/JS/Go）
- `api_design` — API 设计审查
- `security_audit` — 安全审计
- `data_analysis` — 数据分析
- `doc_generation` — 文档生成
- `test_framework` — 测试框架设计

详见 [🎓 远程 Skills 资源管理指南](docs/remote-skills-guide.md)

---

## 🔧 技术亮点

| 特点 | 说明 |
|------|------|
| **React 18 前端** | TypeScript + Vite + Zustand 状态管理，13 个功能组件 |
| **纯 stdlib 后端** | `server.py` 基于 `http.server`，零依赖，同时提供 API + 静态文件服务 |
| **Agent 思考可视** | 实时展示 Agent 的 thinking 过程、工具调用、返回结果 |
| **一键安装** | `install.sh` 自动完成全部配置 |
| **15 秒同步** | 数据自动刷新，看板倒计时显示 |
| **每日启动** | 首次打开播放舰桥启动动画 |
| **远程 Skills 生态** | 从 GitHub/URL 一键导入能力，支持版本管理 + CLI + API + UI |

---

## � 深入了解

### 核心文档

- **[📖 任务分发流转完整架构](docs/task-dispatch-architecture.md)** — **必读文档**
  - 详细讲解太空舰载系统如何处理复杂任务的业务设计和技术实现
  - 涵盖：9大任务状态机 / 权限矩阵 / 4阶段调度（重试→升级→回滚）/ Session JSONL数据融合
  - 包含完整的使用案例、API端点说明、CLI工具文档
  - 对标 CrewAI/AutoGen：为什么制度化>自由协作
  - 故障场景与恢复机制
  - **读这个文档会理解为什么太空舰载系统这么强大**（9500+ 字，30 分钟完整理解）

- **[🎓 远程 Skills 资源管理指南](docs/remote-skills-guide.md)** — Skills 生态
  - 从网上连接和增补 skills，支持 GitHub/Gitee/任意 HTTPS URL
  - 官方 Skills Hub 预设能力库
  - CLI 工具 + 看板 UI + Restful API
  - Skills 文件规范与安全防护
  - 支持版本管理和一键更新

- **[⚡ Remote Skills 快速入门](docs/remote-skills-quickstart.md)** — 5 分钟上手
  - 快速体验、CLI 命令、看板操作示例
  - 创建自己的 Skills 库
  - API 完整参考 + 常见问题

- **[🚀 快速上手指南](docs/getting-started.md)** — 新手入门
- **[🤝 贡献指南](CONTRIBUTING.md)** — 想参与贡献？从这里开始

---
## 🔧 常见问题排查

<details>
<summary><b>❌ 任务总超时 / 下属完成了但无法传回云霄</b></summary>

**症状**：执行节点或中继已完成任务，但云霄收不到回报，最终超时。

**排查步骤**：

1. **检查 Agent 注册状态**：
```bash
curl -s http://127.0.0.1:7891/api/agents-status | python3 -m json.tool
```
确认 `taizi` agent 的 `statusLabel` 是 `alive`。

2. **检查 Gateway 日志**：
```bash
ls /tmp/openclaw/ | tail -5          # 找到最新日志
grep -i "error\|fail\|unknown" /tmp/openclaw/openclaw-*.log | tail -20
```

3. **常见原因**：
   - Agent ID 不匹配（已在 v1.2 修复：`main` → `taizi`）
   - LLM provider 超时（增加了自动重试）
   - 僵尸 Agent 进程（运行 `ps aux | grep openclaw` 检查）

4. **强制重试**：
```bash
# 手动触发巡检扫描（自动重试卡住的任务）
curl -X POST http://127.0.0.1:7891/api/scheduler-scan \
  -H 'Content-Type: application/json' -d '{"thresholdSec":60}'
```

</details>

<details>
<summary><b>❌ Docker: exec format error</b></summary>

**症状**：`exec /usr/local/bin/python3: exec format error`

**原因**：镜像架构（arm64）与主机架构（amd64）不匹配。

**解决**：
```bash
# 方法 1：指定平台
docker run --platform linux/amd64 -p 7891:7891 cft0808/sansheng-demo

# 方法 2：使用 docker-compose（已内置 platform）
docker compose up
```

</details>

<details>
<summary><b>❌ Skill 下载失败</b></summary>

**症状**：`python3 scripts/skill_manager.py import-official-hub` 报错。

**排查**：
```bash
# 测试网络连通性
curl -I https://raw.githubusercontent.com/openclaw-ai/skills-hub/main/code_review/SKILL.md

# 如果超时，使用代理
export https_proxy=http://your-proxy:port
python3 scripts/skill_manager.py import-official-hub --agents zhongshu
```

**常见原因**：
- 中国大陆访问 GitHub raw 资源需要代理
- 网络超时（已增加到 30 秒 + 自动重试 3 次）
- 官方 Skills Hub 仓库维护中

</details>

---
## �🗺️ Roadmap

> 完整路线图及参与方式：[ROADMAP.md](ROADMAP.md)

### Phase 1 — 核心架构 ✅
- [x] 十二节点 Agent 架构（云霄 + 核心链路 + 执行节点 + 天眼）+ 权限矩阵
- [x] 总控台实时看板（10 个功能面板 + 实时活动面板）
- [x] 任务叫停 / 取消 / 恢复
- [x] 任务档案系统（自动归档 + 五阶段时间线）
- [x] 指令模板库（9 个预设 + 参数表单）
- [x] 舰桥启动动画
- [x] 天眼简报 + 飞书推送 + 订阅管理
- [x] 模型热切换 + 技能管理 + 技能添加
- [x] 节点总览 + Token 消耗统计
- [x] 小任务 / 会话监控
- [x] 云霄消息分拣（闲聊自动回复 / 指令建任务）
- [x] 指令数据清洗（路径/元数据/前缀自动剥离）
- [x] 重复任务防护 + 已完成任务保护
- [x] 端到端测试覆盖（17 个断言）
- [x] React 18 前端重构（TypeScript + Vite + Zustand · 13 组件）
- [x] Agent 思考过程可视化（实时 thinking / 工具调用 / 返回结果）
- [x] 前后端一体化部署（server.py 同时提供 API + 静态文件服务）

### Phase 2 — 制度深化 🚧
- [ ] 人工审批模式（人工校核 + 一键通过/打回）
- [ ] 功过簿（Agent 绩效评分体系）
- [ ] 急递铺（Agent 间实时消息流可视化）
- [ ] 国史馆（知识库检索 + 引用溯源）

### Phase 3 — 生态扩展
- [ ] Docker Compose + Demo 镜像
- [ ] Notion / Linear 适配器
- [ ] 年度大考（Agent 年度绩效报告）
- [ ] 移动端适配 + PWA
- [ ] ClawHub 上架

---

## 🤝 参与贡献

欢迎任何形式的贡献！详见 [CONTRIBUTING.md](CONTRIBUTING.md)

特别欢迎的方向：
- 🎨 **UI 增强**：深色/浅色主题、响应式、动画优化
- 🤖 **新 Agent**：适合特定场景的专职 Agent 角色
- 📦 **Skills 生态**：各部门专用技能包
- 🔗 **集成扩展**：Notion · Jira · Linear · GitHub Issues
- 🌐 **国际化**：日文 · 韩文 · 西班牙文
- 📱 **移动端**：响应式适配、PWA

---

## 📂 案例

`examples/` 目录收录了真实的端到端使用案例：

| 案例 | 指令 | 涉及节点 |
|------|------|----------|
| [竞品分析](examples/competitive-analysis.md) | "分析 CrewAI vs AutoGen vs LangGraph" | 星枢→棱镜→源流+维控+文枢 |
| [代码审查](examples/code-review.md) | "审查这段 FastAPI 代码的安全性" | 星枢→棱镜→维控+探针 |
| [周报生成](examples/weekly-report.md) | "生成本周工程团队周报" | 星枢→棱镜→源流+文枢 |

每个案例包含：完整指令 → 星枢规划 → 棱镜校核意见 → 各节点执行结果 → 最终任务档案。

---

## ⭐ Star History

如果这个项目让你会心一笑，请给个 Star ⚔️

[![Star History Chart](https://api.star-history.com/svg?repos=cft0808/edict&type=Date)](https://star-history.com/#cft0808/edict&Date)

---

## 📮 项目简报——公众号

> 关注公众号，持续获取架构拆解、实战复盘与更新动态。

<p align="center">
  <img src="docs/assets/wechat-qrcode.jpg" width="220" alt="公众号二维码 · cft0808">
  <br><br>
  <b>👆 扫码关注「cft0808」—— 项目技术简报</b>
</p>

你会看到：

- 🏛️ **架构拆解** —— 太空舰载系统到底怎么分权制衡的？12 个 Agent 各司何职？
- 🔥 **踩坑复盘** —— Agent 吵架了怎么办？Token 烧光了怎么省？棱镜为什么总打回修订？
- 🛠️ **Issue 修复实录** —— 每个 bug 都是一道任务档案，看系统如何收敛到可交付结果
- 💡 **Token 省钱术** —— 用 1/10 的 token 跑出棱镜校核效果的秘密
- 🎭 **Agent 人设彩蛋** —— 执行节点的 SOUL.md 是怎么写出来的？

> *"真正让系统稳定的，不是更多 Agent，而是更清晰的协作边界。"*

---

## 📄 License

[MIT](LICENSE) · 由 [OpenClaw](https://openclaw.ai) 社区构建

---

<p align="center">
  <strong>⚔️ 用清晰边界管理协作，用实时看板驾驭 AI</strong><br>
  <sub>Governing AI with explicit orchestration and live observability</sub><br><br>
  <a href="#-项目简报公众号"><img src="https://img.shields.io/badge/公众号_cft0808-关注获取更新-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="WeChat"></a>
</p>
