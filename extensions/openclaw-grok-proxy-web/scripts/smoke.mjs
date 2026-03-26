import assert from "node:assert/strict";
import pluginEntry from "../index.js";

const providers = [];

await pluginEntry.register({
  registerWebSearchProvider(provider) {
    providers.push(provider);
  },
});

assert.equal(providers.length, 1, "expected exactly one web search provider");
const provider = providers[0];
assert.equal(provider.id, "openclaw-grok-proxy-web");
assert.equal(typeof provider.applySelectionConfig, "function");

const selected = provider.applySelectionConfig({
  plugins: {
    allow: ["openclaw-lark"],
    entries: {},
  },
});

assert.equal(selected.tools.web.search.provider, "openclaw-grok-proxy-web");
assert.equal(selected.plugins.entries["openclaw-grok-proxy-web"].enabled, true);
assert.ok(selected.plugins.allow.includes("openclaw-grok-proxy-web"));

const tool = provider.createTool({ config: selected, searchConfig: {} });
const missingCredential = await tool.execute({ query: "smoke test query", count: 3 });
assert.equal(missingCredential.error, "missing_grok_proxy_web_api_key");

console.log(
  JSON.stringify(
    {
      ok: true,
      providerId: provider.id,
      defaultProvider: selected.tools.web.search.provider,
      missingCredentialError: missingCredential.error,
    },
    null,
    2,
  ),
);
