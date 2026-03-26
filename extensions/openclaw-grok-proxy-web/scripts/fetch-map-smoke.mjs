import assert from "node:assert/strict";
import pluginEntry, { __testing } from "../index.js";

const tools = [];
await pluginEntry.register({
  config: {
    plugins: {
      entries: {
        "openclaw-grok-proxy-web": {
          enabled: true,
          config: {
            fetch: {
              timeout: 21,
              retry: 2,
              cacheTtl: 11,
              maxChars: 2048,
              tavilyExtractDepth: "advanced",
            },
            map: {
              timeout: 77,
              retry: 2,
              cacheTtl: 9,
              limit: 64,
              maxDepth: 2,
              maxBreadth: 30,
              includeSubdomains: true,
            },
          },
        },
      },
    },
  },
  registerWebSearchProvider() {},
  registerTool(tool) {
    tools.push(tool);
  },
});

assert.deepEqual(tools.map((tool) => tool.name).sort(), ["grok_fetch", "grok_map"]);

const fetchTool = tools.find((tool) => tool.name === "grok_fetch");
const mapTool = tools.find((tool) => tool.name === "grok_map");

const missingFetch = await fetchTool.execute("call-fetch", { url: "https://example.com" });
assert.equal(missingFetch.details.error, "grok_fetch_failed");
assert.ok(missingFetch.details.message.includes("credentials"));

const missingMap = await mapTool.execute("call-map", { url: "https://example.com" });
assert.equal(missingMap.details.error, "grok_map_failed");
assert.ok(missingMap.details.message.includes("credentials"));

assert.equal(__testing.resolveFeatureRuntime({
  plugins: {
    entries: {
      "openclaw-grok-proxy-web": {
        config: {
          fetch: { maxChars: 3000 },
          map: { limit: 12 },
        },
      },
    },
  },
}, "fetch").maxChars, 3000);
assert.equal(__testing.buildDomainRegex("https://docs.example.com/start", true), "(^|\\.)docs\\.example\\.com$");
assert.equal(__testing.buildDomainRegex("https://docs.example.com/start", false), "^docs\\.example\\.com$");
assert.deepEqual(
  __testing.normalizeDiscoveredUrls([
    "https://example.com/",
    "/docs",
    { url: "https://example.com/docs" },
    { href: "/pricing" },
  ], "https://example.com", 10),
  ["https://example.com/", "https://example.com/docs", "https://example.com/pricing"],
);

console.log(
  JSON.stringify(
    {
      ok: true,
      toolNames: tools.map((tool) => tool.name).sort(),
      missingFetch: missingFetch.details,
      missingMap: missingMap.details,
      fetchRuntime: __testing.resolveFeatureRuntime({
        plugins: {
          entries: {
            "openclaw-grok-proxy-web": {
              config: {
                fetch: {
                  timeout: 21,
                  retry: 2,
                  cacheTtl: 11,
                  maxChars: 2048,
                  tavilyExtractDepth: "advanced",
                },
              },
            },
          },
        },
      }, "fetch"),
      mapRuntime: __testing.resolveFeatureRuntime({
        plugins: {
          entries: {
            "openclaw-grok-proxy-web": {
              config: {
                map: {
                  timeout: 77,
                  retry: 2,
                  cacheTtl: 9,
                  limit: 64,
                  maxDepth: 2,
                  maxBreadth: 30,
                  includeSubdomains: true,
                },
              },
            },
          },
        },
      }, "map"),
    },
    null,
    2,
  ),
);
