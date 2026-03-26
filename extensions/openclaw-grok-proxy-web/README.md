# openclaw-grok-proxy-web

阶段 1：一个 **OpenClaw 原生插件**，先接管 `web_search`，把搜索请求转发到 **第三方 Grok / OpenAI 兼容 chat/completions** 端点。

## 现在已落地的内容

- 原生插件骨架：`extensions/openclaw-grok-proxy-web/`
- 注册 `registerWebSearchProvider(...)`
- provider id 固定为：`openclaw-grok-proxy-web`
- 支持插件配置项：
  - `baseUrl`
  - `apiKey`
  - `model`
  - `timeout`
  - `retry`
  - `cacheTtl`
- 请求主通路：`{baseUrl}/chat/completions`
  - 优先用 xAI/Grok 风格 `search_parameters`
  - 若兼容层报字段不支持，再尝试 `web_search_options`
- 内置缓存与重试
- `applySelectionConfig()` 已就绪，可把 `tools.web.search.provider` 切到本 provider

## 插件源码放置位置

当前源码位于：

- `/home/muqing/edict/extensions/openclaw-grok-proxy-web`

这是**源码/提交落点**。OpenClaw 运行时建议通过 `plugins.load.paths` 链接加载这一路径，而不是把代码散落到 `~/.openclaw/extensions` 里直接手改。

> 当前机器为了本地验证，已在插件目录下创建未跟踪的依赖链接：
>
> - `node_modules/openclaw -> /usr/local/lib/nodejs/node-v24.14.0-linux-x64/lib/node_modules/openclaw`
>
> 如果后续把插件迁到别的机器/目录，请在插件目录重新安装或链接 `openclaw` 依赖。

## 如何接入 OpenClaw

### 方案 A：推荐，链接本地源码目录

把下面配置加入 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "allow": [
      "openclaw-lark",
      "openclaw-grok-proxy-web"
    ],
    "load": {
      "paths": [
        "/home/muqing/edict/extensions/openclaw-grok-proxy-web"
      ]
    },
    "entries": {
      "openclaw-grok-proxy-web": {
        "enabled": true,
        "config": {
          "webSearch": {
            "baseUrl": "https://<your-grok-compatible-host>/v1",
            "apiKey": "<secret-or-secret-ref>",
            "model": "grok-3-search-latest",
            "timeout": 30,
            "retry": 1,
            "cacheTtl": 15
          }
        }
      }
    }
  },
  "tools": {
    "web": {
      "search": {
        "provider": "openclaw-grok-proxy-web"
      }
    }
  }
}
```

> 注意：**配置改完后需要 restart gateway**，OpenClaw 文档明确写了 config 改动需重启生效。

### 方案 B：CLI 链接安装

```bash
openclaw plugins install -l /home/muqing/edict/extensions/openclaw-grok-proxy-web
```

然后同样把：

```json
{
  "tools": {
    "web": {
      "search": {
        "provider": "openclaw-grok-proxy-web"
      }
    }
  }
}
```

写入配置，并重启 gateway。

## 配置说明

插件读取：

- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.baseUrl`
- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.apiKey`
- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.model`
- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.timeout`
- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.retry`
- `plugins.entries.openclaw-grok-proxy-web.config.webSearch.cacheTtl`

也支持环境变量兜底：

- `GROK_PROXY_WEB_API_KEY`
- `XAI_API_KEY`
- `GROK_PROXY_WEB_BASE_URL`
- `GROK_PROXY_WEB_MODEL`
- `GROK_PROXY_WEB_TIMEOUT`
- `GROK_PROXY_WEB_RETRY`
- `GROK_PROXY_WEB_CACHE_TTL`

## 第 1 步验证建议

1. 先执行基础 smoke test（验证 provider 注册、默认切换、插件配置读取）：

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/smoke.mjs
```

2. 再执行兼容层 smoke（离线验证 `search_parameters -> web_search_options` 双 payload、响应归一化，以及配置注入后会真正走请求链路）：

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/mock-compat-smoke.mjs
```

3. 再确认 OpenClaw 已加载该插件并把 `web_search` provider 指到：

- `openclaw-grok-proxy-web`

4. 设置真实 `baseUrl/apiKey/model` 后，重启 gateway，再跑一次 `web_search`。

## 后续 2 / 3 / 4 步的边界

### 第 2 步：`grok_fetch / grok_map`

建议继续放在**同一个插件**内，但与 `web_search` 分层：

- `src/fetch/`：抓取适配层
- `src/map/`：站点归一化 / URL 聚合
- Tavily 主抓取
- Firecrawl fallback

这样不会把第 1 步的搜索 provider 搅乱。

### 第 3 步：诊断工具

同插件内新增：

- `grok_web_diag`

最少输出：

- 搜索主通路是否通
- fetch 是否通
- Tavily / Firecrawl 哪一路生效
- 当前 provider / baseUrl / model（脱敏）
- 是否命中 fallback

### 第 4 步：透明接管内置 `web_fetch`

不建议在第 1 步直接硬改内置逻辑。

推荐路线：

1. 先把 `grok_fetch` 跑稳
2. 再做诊断闭环
3. 最后评估：
   - 通过新的 fetch provider/hook 透明接管
   - 或在 OpenClaw 内补 provider 化能力后正式替换内置 `web_fetch`

这样不会把现有抓取能力一次性打碎，也方便回滚。

## 回滚

- 从 `plugins.load.paths` 移除该路径
- 把 `tools.web.search.provider` 改回原 provider
- 重启 gateway

即可回退。
