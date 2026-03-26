import assert from "node:assert/strict";
import pluginEntry, { __testing } from "../index.js";

const variants = __testing.buildRequestVariants({
  model: "grok-compatible-search",
  query: "OpenClaw Grok provider compat fallback test",
  count: 6,
  region: "cn",
  safeSearch: "moderate",
});

assert.equal(variants.length, 2, "expected xAI + OpenAI-compatible request variants");
assert.equal(variants[0].id, "xai-search-parameters");
assert.equal(variants[0].body.search_parameters.max_search_results, 6);
assert.equal(variants[1].id, "openai-web-search-options");
assert.equal(variants[1].body.web_search_options.search_context_size, "medium");

const normalized = __testing.extractSearchPayload(
  {
    model: "grok-compatible-search",
    citations: ["https://example.com/a", { url: "https://example.com/b" }],
    choices: [{ message: { content: [{ text: "mocked answer from compat endpoint" }] } }],
  },
  "fallback-model",
);
assert.deepEqual(normalized, {
  model: "grok-compatible-search",
  content: "mocked answer from compat endpoint",
  citations: ["https://example.com/a", "https://example.com/b"],
});

const providers = [];
await pluginEntry.register({
  registerWebSearchProvider(provider) {
    providers.push(provider);
  },
});

assert.equal(providers.length, 1, "expected exactly one web search provider");
const provider = providers[0];
const tool = provider.createTool({
  config: {
    plugins: {
      entries: {
        "openclaw-grok-proxy-web": {
          enabled: true,
          config: {
            webSearch: {
              baseUrl: "https://example.invalid/v1",
              apiKey: "sk-local-test",
              model: "grok-compatible-search",
              timeout: 3,
              retry: 0,
              cacheTtl: 0,
            },
          },
        },
      },
    },
    tools: {
      web: {
        search: {
          provider: "openclaw-grok-proxy-web",
        },
      },
    },
  },
  searchConfig: {},
});

const result = await tool.execute({
  query: "OpenClaw Grok provider compat fallback test",
  count: 6,
  safeSearch: "moderate",
});
assert.equal(result.error, "grok_proxy_web_search_failed");
assert.notEqual(result.error, "missing_grok_proxy_web_api_key");
assert.ok(String(result.message).length > 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      providerId: provider.id,
      variants,
      normalized,
      executeResult: result,
    },
    null,
    2,
  ),
);
