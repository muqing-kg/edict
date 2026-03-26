# openclaw-grok-proxy-web

一个 **OpenClaw 原生插件**，当前已在同一插件内落地三块能力：

1. `web_search` provider：转发到第三方 Grok / OpenAI 兼容 `chat/completions`
2. `grok_fetch`：Tavily 主抓取，Firecrawl fallback
3. `grok_map`：Tavily 主映射，Firecrawl fallback

这轮的边界是：**先把自定义 fetch / map 做稳**，为后续“透明接管内置 `web_fetch`”预留接口和配置边界，但本轮不硬改内置逻辑。

---

## 已落地内容

### Phase 1：搜索 provider

- 注册 `registerWebSearchProvider(...)`
- provider id：`openclaw-grok-proxy-web`
- 支持：`baseUrl / apiKey / model / timeout / retry / cacheTtl`
- 请求主通路：`{baseUrl}/chat/completions`
  - 优先用 xAI/Grok 风格 `search_parameters`
  - 兼容失败后回落到 `web_search_options`
- 内置缓存与重试
- `applySelectionConfig()` 可把 `tools.web.search.provider` 切到本 provider

### Phase 2：同插件补 `grok_fetch / grok_map`

#### `grok_fetch`

- 工具名：`grok_fetch`
- 主链路：**Tavily `/extract`**
- 兜底：**Firecrawl `/v2/scrape`**
- 支持：
  - URL 抓取
  - `markdown` / `text` 输出
  - `timeoutSeconds` / `retry` 请求级覆写
  - `maxChars` 截断
- 结果会返回：
  - `provider` / `providerChain`
  - `fallbackUsed`
  - `title` / `finalUrl` / `status`
  - `text`
  - `truncated` / `rawLength` / `wrappedLength`

#### `grok_map`

- 工具名：`grok_map`
- 主链路：**Tavily `/map`**
- 兜底：**Firecrawl `/v2/map`**
- 支持：
  - 站点结构发现 / 映射
  - `limit`
  - `includeSubdomains`
  - `depth`
  - `instructions`（Tavily 聚焦映射）
- 结果会返回：
  - `provider` / `providerChain`
  - `fallbackUsed`
  - `count`
  - `links[]`

---

## 插件源码位置

源码位于：

- `/home/muqing/edict/extensions/openclaw-grok-proxy-web`

推荐通过 `plugins.load.paths` 链接源码目录加载，不要把代码散落到 `~/.openclaw/extensions` 里手改。

---

## 如何接入 OpenClaw

### 方案 A：推荐，直接加载本地源码目录

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
          },
          "tavily": {
            "apiKey": "<tavily-secret-or-secret-ref>",
            "baseUrl": "https://api.tavily.com"
          },
          "firecrawl": {
            "apiKey": "<firecrawl-secret-or-secret-ref>",
            "baseUrl": "https://api.firecrawl.dev"
          },
          "fetch": {
            "timeout": 30,
            "retry": 1,
            "cacheTtl": 15,
            "maxChars": 12000,
            "tavilyExtractDepth": "basic",
            "firecrawlOnlyMainContent": true,
            "firecrawlProxy": "auto"
          },
          "map": {
            "timeout": 60,
            "retry": 1,
            "cacheTtl": 15,
            "limit": 50,
            "maxDepth": 1,
            "maxBreadth": 20,
            "includeSubdomains": true,
            "allowExternal": false
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

> 配置改完后需要 **restart gateway** 才会生效。

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

---

## 配置项说明

### `webSearch`

搜索 provider 的配置：

- `baseUrl`
- `apiKey`
- `model`
- `timeout`
- `retry`
- `cacheTtl`

### `tavily`

供 `grok_fetch / grok_map` 复用：

- `apiKey`
- `baseUrl`
- `timeout`（可选）
- `retry`（可选）
- `cacheTtl`（可选）

### `firecrawl`

供 fallback 复用：

- `apiKey`
- `baseUrl`
- `timeout`（可选）
- `retry`（可选）
- `cacheTtl`（可选）

### `fetch`

`grok_fetch` 默认行为：

- `timeout`
- `retry`
- `cacheTtl`
- `maxChars`
- `tavilyExtractDepth`
- `tavilyIncludeImages`
- `firecrawlOnlyMainContent`
- `firecrawlMaxAgeMs`
- `firecrawlProxy`
- `firecrawlStoreInCache`

### `map`

`grok_map` 默认行为：

- `timeout`
- `retry`
- `cacheTtl`
- `limit`
- `maxDepth`
- `maxBreadth`
- `includeSubdomains`
- `allowExternal`

---

## 环境变量兜底

### 搜索 provider

- `GROK_PROXY_WEB_API_KEY`
- `XAI_API_KEY`
- `GROK_PROXY_WEB_BASE_URL`
- `GROK_PROXY_WEB_MODEL`
- `GROK_PROXY_WEB_TIMEOUT`
- `GROK_PROXY_WEB_RETRY`
- `GROK_PROXY_WEB_CACHE_TTL`

### Tavily / Firecrawl

- `GROK_PROXY_WEB_TAVILY_API_KEY`
- `TAVILY_API_KEY`
- `GROK_PROXY_WEB_TAVILY_BASE_URL`
- `TAVILY_BASE_URL`
- `GROK_PROXY_WEB_FIRECRAWL_API_KEY`
- `FIRECRAWL_API_KEY`
- `GROK_PROXY_WEB_FIRECRAWL_BASE_URL`
- `FIRECRAWL_BASE_URL`
- `GROK_PROXY_WEB_FETCH_TIMEOUT`
- `GROK_PROXY_WEB_FETCH_RETRY`
- `GROK_PROXY_WEB_FETCH_CACHE_TTL`
- `GROK_PROXY_WEB_MAP_TIMEOUT`
- `GROK_PROXY_WEB_MAP_RETRY`
- `GROK_PROXY_WEB_MAP_CACHE_TTL`

---

## 工具使用示例

### `grok_fetch`

```json
{
  "url": "https://docs.tavily.com/documentation/api-reference/endpoint/map",
  "extractMode": "markdown",
  "maxChars": 8000
}
```

### `grok_map`

```json
{
  "url": "https://docs.tavily.com",
  "limit": 30,
  "includeSubdomains": true,
  "depth": 2
}
```

---

## 本地验证

### 1) 基础 smoke

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/smoke.mjs
```

验证：

- `web_search` provider 注册
- `grok_fetch / grok_map` 工具注册
- 统一配置读取
- 缺凭证错误路径

### 2) compat + parser smoke

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/mock-compat-smoke.mjs
```

验证：

- `search_parameters -> web_search_options` 双 payload
- 搜索响应归一化
- Tavily / Firecrawl mock payload 解析
- map payload 解析

### 3) fetch / map smoke

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/fetch-map-smoke.mjs
```

验证：

- `grok_fetch / grok_map` 工具对象可执行
- 配置默认值和帮助错误输出
- 域名约束与 URL 归一化逻辑

### 4) provider chain smoke（推荐）

```bash
node /home/muqing/edict/extensions/openclaw-grok-proxy-web/scripts/provider-chain-smoke.mjs
```

验证：

- Tavily `/extract` 失败后，`grok_fetch` 会切到 Firecrawl `/v2/scrape`
- `grok_map` 默认优先走 Tavily `/map`
- 请求体字段与 fallback 链路按预期工作

---

## 回滚

- 从 `plugins.load.paths` 移除该路径
- 把 `tools.web.search.provider` 改回原 provider
- 重启 gateway

即可回退。

---

## 后续 Phase 3 / 4 边界

### Phase 3：诊断工具

建议继续在同插件补：

- `grok_web_diag`

至少输出：

- 当前 `web_search / grok_fetch / grok_map` 的配置摘要（脱敏）
- Tavily 主链路是否通
- Firecrawl fallback 是否可用
- 最近一次 fallback 原因
- 当前 provider / timeout / retry / cache 命中情况

### Phase 4：透明接管内置 `web_fetch`

建议路线：

1. 先把 `grok_fetch` 线上跑稳
2. 再补 `grok_web_diag`
3. 再评估通过 provider/hook 或上游补 fetch provider 化能力，正式替换内置 `web_fetch`

这样可以保留回滚空间，不会一次性把内置抓取链路打碎。
