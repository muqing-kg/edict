# 舰载体系 Windows 安装说明（简明版 + 详细版）

> 适用于 Windows 用户。当前版本保留 `main` 作为运行时入口 ID，界面语义上对应“云霄入口”；其余节点使用 `xingshu / lengjing / zhongji / yuanliu / wenshu / weikong / tanzhen / jiwu / xulie / tianyan`。

---

# 一、最简单版本：照着做就能装

## 1. 下载项目
把项目放到你自己的 OpenClaw workspace 里，例如：

```text
C:\Users\<YOUR_USER>\.openclaw\workspace\skills\edict
```

> 你实际目录名可以不是 `edict`，但后面命令里的路径要对应修改。

---

## 2. 如果以前装过旧版本，先删除旧链接
如果你之前已经安装过更早的版本，请先检查 `C:\Users\<YOUR_USER>\.openclaw` 下所有 `workspace*` 目录，删除里面旧的 `data` / `scripts` 链接。

重点处理：

- `workspace\data`
- `workspace-*\data`
- `workspace\scripts`
- `workspace-*\scripts`

如果不清理旧链接，第一次运行安装脚本时，可能会因为“链接已经存在”而失败，或者继续读到旧仓库的数据。

---

## 3. 运行安装脚本
在 PowerShell 里进入项目目录：

```powershell
cd C:\Users\<YOUR_USER>\.openclaw\workspace\skills\edict
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## 4. 安装后检查两件事

### A. 检查 agent / subagent 配置是否写进 `openclaw.json`
安装脚本正常情况下会写入，但建议你安装后自己确认一次。

如果没有正确写进去，可以参考本仓库附带的 `agents.json` 脱敏模板。使用时请先把其中的 `<YOUR_USER>` 替换成你自己的系统用户名，再复制到对应配置中。

### B. 检查 `tools.sessions.visibility = all`
安装脚本会尝试设置，但建议你手动确认一次。

如果没有生效，执行：

```powershell
openclaw config set tools.sessions.visibility all
```

---

## 5. 启动后台刷新循环
在 Git Bash / MINGW64 里运行：

```bash
cd ~/.openclaw/workspace/skills/edict/scripts
bash run_loop.sh
```

> 这个脚本负责后台持续刷新数据。

---

## 6. 启动 dashboard
在 PowerShell 里运行：

```powershell
cd C:\Users\<YOUR_USER>\.openclaw\workspace\skills\edict
python dashboard\server.py
```

然后浏览器打开：

```text
http://127.0.0.1:7891
```

> `server.py` 默认提供的是 `dashboard/dist/index.html` 这套 React 前端；`dashboard/dashboard.html` 只保留为历史单文件参考页。

---

# 二、安装完成后你应该看到什么

正常情况下：

- 面板可以打开
- `节点总览` 能显示节点活跃度和令牌统计
- `模型矩阵` 能显示 agent 列表和模型信息
- 右上角 Gateway 状态正常
- 倒计时会持续刷新页面数据

---

# 三、详细说明

## 1. 为什么要先删旧链接

如果你以前已经安装过旧版本，那么：

- `workspace*\data`
- `workspace*\scripts`

很可能还指向旧仓库。

这时你再运行新的 `install.ps1`，第一次可能出现：

- symlink / junction 创建失败
- 安装脚本看起来跑完了，但实际 workspace 仍然连着旧版本
- dashboard 打开了，但显示的是旧数据

所以最稳妥的做法是：

## 先删旧链接，再运行安装脚本

---

## 2. 为什么安装后还要核对 agent / subagent 配置

在部分环境里，安装脚本可能没有把当前节点配置完整落进 `openclaw.json`。

因此建议你安装后主动确认至少存在以下 agent id：

- `main`
- `xingshu`
- `lengjing`
- `zhongji`
- `yuanliu`
- `wenshu`
- `weikong`
- `tanzhen`
- `jiwu`
- `xulie`
- `tianyan`

其中：

- `main` 是唯一运行时入口
- 界面语义上的“云霄入口”对应 `main`
- 其余节点权限关系可直接参考仓库根目录的 `agents.json`

如果缺失，可以直接参考本仓库附带的 `agents.json` 脱敏模板；使用前请先把 `<YOUR_USER>` 替换成你自己的系统用户名。

---

## 3. `agents.json` 是干什么用的

本仓库附带了一个脱敏版的：

```text
agents.json
```

它保留了当前节点配置结构，包括：

- `id`
- `name`
- `workspace`
- `agentDir`
- `subagents.allowAgents`

其中路径部分已经用 `<YOUR_USER>` 做了脱敏处理。

使用时请先把：

```text
<YOUR_USER>
```

替换成你自己的 Windows 用户名，再复制到对应配置中。

---

## 4. 为什么还要确认 `tools.sessions.visibility = all`

这个设置会影响 session 工具可见性，对多 agent 协同很重要。

虽然安装脚本会尝试设置，但建议安装后自己再确认一次。

如果没生效，手动执行：

```powershell
openclaw config set tools.sessions.visibility all
```

---

## 5. 为什么还要跑 `run_loop.sh`

dashboard 右上角虽然有一个倒计时，但它只是定时重新读取现有 API 数据。

它并不会自动帮你在后台持续生成数据。

真正负责后台数据刷新的，是：

```bash
bash run_loop.sh
```

它会持续执行同步脚本，更新：

- `live_status.json`
- `nodes_stats.json`
- `agent_config.json`

所以：

- dashboard 倒计时 = **读数据**
- `run_loop.sh` = **产数据 / 刷数据**

Windows 下也建议正常运行 `run_loop.sh`。

---

## 6. 如果 dashboard 提示“请先启动服务器”怎么办

这句文案有时是误导性的。它不一定表示 `dashboard/server.py` 真没启动。

更常见的真实原因是：

- API 返回了空对象
- 读取到了旧仓库的数据
- 当前启动的不是你想要的那个 dashboard server

排查时建议直接访问：

```text
http://127.0.0.1:7891/api/nodes-stats
http://127.0.0.1:7891/api/agent-config
http://127.0.0.1:7891/api/live-status
```

如果这三个接口能正常返回 JSON，说明 server 没问题。

---

## 7. 如果 dashboard 提示 Gateway 没启动怎么办

如果你使用的是当前版本，这个问题通常不是 Gateway 真没起，而是：

- 浏览器连到旧的本地 server
- 当前目录不是你要运行的那份仓库
- 页面缓存还停在旧资源

所以如果你仍然看到 Gateway 未启动：

- 先确认自己现在运行的是当前仓库里的 `dashboard/server.py`
- 再确认浏览器访问的不是旧的本地 server 进程
- 必要时强制刷新页面，确认加载的是新的 `dashboard/dist` 产物

---

# 四、推荐的完整使用顺序

## 第一步
清理旧 `workspace*` 里的 `data` / `scripts`

## 第二步
运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## 第三步
检查：

- agent / subagent 配置
- `tools.sessions.visibility = all`

必要时可参考：

```text
agents.json
```

## 第四步
启动后台刷新循环：

```bash
bash run_loop.sh
```

## 第五步
启动 dashboard：

```powershell
python dashboard\server.py
```

---

# 五、一句话总结

## Windows 用户最稳的做法就是：
先清旧链接，再运行安装脚本；安装后检查 agent 配置和 `tools.sessions.visibility = all`；如有需要可参考 `agents.json` 脱敏模板并替换 `<YOUR_USER>`；最后启动 `run_loop.sh` 和 `dashboard/server.py`。
