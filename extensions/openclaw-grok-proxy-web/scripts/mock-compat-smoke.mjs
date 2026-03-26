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

const tavilyFetch = __testing.parseTavilyFetchPayload({
  payload: {
    results: [{
      url: "https://example.com/article",
      raw_content: "# Title\n\nBody text from Tavily.",
      images: ["https://example.com/image.png"],
    }],
  },
  url: "https://example.com/article",
  extractMode: "markdown",
  maxChars: 500,
});
assert.equal(tavilyFetch.provider, "tavily");
assert.equal(tavilyFetch.extractMode, "markdown");
assert.ok(tavilyFetch.text.includes("Body text from Tavily"));

const firecrawlFetch = __testing.parseFirecrawlFetchPayload({
  payload: {
    data: {
      metadata: {
        sourceURL: "https://example.com/page",
        title: "Example Page",
        statusCode: 200,
      },
      markdown: "# Example\n\n- bullet one\n- bullet two",
    },
  },
  url: "https://example.com/page",
  extractMode: "text",
  maxChars: 500,
});
assert.equal(firecrawlFetch.provider, "firecrawl");
assert.equal(firecrawlFetch.status, 200);
assert.ok(firecrawlFetch.text.includes("bullet one"));

const tavilyMap = __testing.parseMapPayload({
  payload: {
    results: [
      "https://example.com/",
      { url: "https://example.com/docs" },
      { link: "/pricing" },
    ],
  },
  url: "https://example.com/",
  provider: "tavily",
  limit: 10,
});
assert.deepEqual(tavilyMap.links, [
  "https://example.com/",
  "https://example.com/docs",
  "https://example.com/pricing",
]);

const providers = [];
const tools = [];
await pluginEntry.register({
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
  registerWebSearchProvider(provider) {
    providers.push(provider);
  },
  registerTool(tool) {
    tools.push(tool);
  },
});

assert.equal(providers.length, 1, "expected exactly one web search provider");
assert.deepEqual(tools.map((tool) => tool.name).sort(), ["grok_fetch", "grok_map"]);

const result = await providers[0].createTool({
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
}).execute({
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
      providerId: providers[0].id,
      toolNames: tools.map((tool) => tool.name).sort(),
      variants,
      normalized,
      tavilyFetch,
      firecrawlFetch,
      tavilyMap,
      executeResult: result,
    },
    null,
    2,
  ),
);
