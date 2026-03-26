import assert from "node:assert/strict";
import pluginEntry, { __testing } from "../index.js";

const providers = [];
const tools = [];

const baseConfig = {
  plugins: {
    allow: ["openclaw-lark"],
    entries: {
      "openclaw-grok-proxy-web": {
        enabled: true,
        config: {
          webSearch: {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "grok-test-model",
            timeout: 12,
            retry: 2,
            cacheTtl: 9,
          },
          tavily: {
            apiKey: "tvly-test",
            baseUrl: "https://api.tavily.test",
          },
          firecrawl: {
            apiKey: "fc-test",
            baseUrl: "https://api.firecrawl.test",
          },
          fetch: {
            timeout: 25,
            retry: 1,
            cacheTtl: 10,
            maxChars: 4000,
          },
          map: {
            timeout: 55,
            retry: 1,
            cacheTtl: 8,
            limit: 42,
            maxDepth: 2,
            includeSubdomains: false,
          },
        },
      },
    },
  },
};

await pluginEntry.register({
  config: baseConfig,
  registerWebSearchProvider(provider) {
    providers.push(provider);
  },
  registerTool(tool) {
    tools.push(tool);
  },
});

assert.equal(providers.length, 1, "expected exactly one web search provider");
assert.equal(tools.length, 2, "expected grok_fetch and grok_map to register");
const provider = providers[0];
assert.equal(provider.id, "openclaw-grok-proxy-web");
assert.equal(typeof provider.applySelectionConfig, "function");
assert.deepEqual(
  tools.map((tool) => tool.name).sort(),
  ["grok_fetch", "grok_map"],
  "expected grok_fetch and grok_map tool names",
);

const selected = provider.applySelectionConfig(structuredClone(baseConfig));
assert.equal(selected.tools.web.search.provider, "openclaw-grok-proxy-web");
assert.equal(selected.plugins.entries["openclaw-grok-proxy-web"].enabled, true);
assert.ok(selected.plugins.allow.includes("openclaw-grok-proxy-web"));
assert.deepEqual(__testing.resolvePluginConfig(selected), {
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  model: "grok-test-model",
  timeout: 12,
  retry: 2,
  cacheTtl: 9,
});
assert.equal(__testing.resolvePluginEntryConfig(selected).fetch.maxChars, 4000);
assert.equal(__testing.resolveFeatureRuntime(selected, "map").limit, 42);
assert.equal(__testing.resolveTavilyRuntime(selected, "fetch").baseUrl, "https://api.tavily.test");
assert.equal(__testing.resolveFirecrawlRuntime(selected, "map").baseUrl, "https://api.firecrawl.test");

const searchTool = provider.createTool({
  config: provider.applySelectionConfig({
    plugins: {
      allow: ["openclaw-lark"],
      entries: {},
    },
  }),
  searchConfig: {},
});
const missingCredential = await searchTool.execute({ query: "smoke test query", count: 3 });
assert.equal(missingCredential.error, "missing_grok_proxy_web_api_key");

console.log(
  JSON.stringify(
    {
      ok: true,
      providerId: provider.id,
      defaultProvider: selected.tools.web.search.provider,
      toolNames: tools.map((tool) => tool.name).sort(),
      resolvedPluginConfig: __testing.resolvePluginConfig(selected),
      resolvedFetchConfig: __testing.resolveFeatureRuntime(selected, "fetch"),
      resolvedMapConfig: __testing.resolveFeatureRuntime(selected, "map"),
      missingCredentialError: missingCredential.error,
    },
    null,
    2,
  ),
);
