import assert from "node:assert/strict";
import http from "node:http";
import pluginEntry from "../index.js";

const calls = [];

const server = http.createServer(async (req, res) => {
  const body = await new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
  });
  const parsed = body ? JSON.parse(body) : {};
  calls.push({ method: req.method, url: req.url, body: parsed });

  if (req.url === "/extract") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock tavily failure" }));
    return;
  }

  if (req.url === "/v2/scrape") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      data: {
        metadata: {
          sourceURL: parsed.url,
          title: "Fallback Title",
          statusCode: 200,
        },
        markdown: "# From Firecrawl\n\nThis is fallback content.",
      },
    }));
    return;
  }

  if (req.url === "/map") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      results: [
        parsed.url,
        `${parsed.url.replace(/\/$/, "")}/docs`,
        `${parsed.url.replace(/\/$/, "")}/pricing`,
      ],
      usage: {
        mapped: 3,
      },
    }));
    return;
  }

  if (req.url === "/v2/map") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      links: [
        parsed.url,
        `${parsed.url.replace(/\/$/, "")}/fallback-map`,
      ],
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const tools = [];
  await pluginEntry.register({
    config: {
      plugins: {
        entries: {
          "openclaw-grok-proxy-web": {
            enabled: true,
            config: {
              tavily: {
                apiKey: "tvly-local",
                baseUrl,
              },
              firecrawl: {
                apiKey: "fc-local",
                baseUrl,
              },
              fetch: {
                timeout: 10,
                retry: 0,
                cacheTtl: 0,
                maxChars: 4000,
              },
              map: {
                timeout: 10,
                retry: 0,
                cacheTtl: 0,
                limit: 20,
                maxDepth: 2,
                includeSubdomains: false,
                allowExternal: false,
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

  const fetchTool = tools.find((tool) => tool.name === "grok_fetch");
  const mapTool = tools.find((tool) => tool.name === "grok_map");

  const fetchResult = await fetchTool.execute("fetch-call", {
    url: "https://example.com/article",
    extractMode: "text",
  });
  assert.equal(fetchResult.details.provider, "firecrawl");
  assert.equal(fetchResult.details.fallbackUsed, true);
  assert.deepEqual(fetchResult.details.providerChain, ["tavily", "firecrawl"]);
  assert.ok(fetchResult.details.text.includes("fallback content"));

  const mapResult = await mapTool.execute("map-call", {
    url: "https://example.com",
    limit: 10,
    depth: 2,
    includeSubdomains: false,
  });
  assert.equal(mapResult.details.provider, "tavily");
  assert.equal(mapResult.details.fallbackUsed, false);
  assert.deepEqual(mapResult.details.providerChain, ["tavily"]);
  assert.deepEqual(mapResult.details.links, [
    "https://example.com/",
    "https://example.com/docs",
    "https://example.com/pricing",
  ]);

  assert.ok(calls.some((call) => call.url === "/extract"), "expected Tavily extract call");
  assert.ok(calls.some((call) => call.url === "/v2/scrape"), "expected Firecrawl scrape fallback call");
  assert.ok(calls.some((call) => call.url === "/map"), "expected Tavily map call");

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    calls,
    fetchResult: fetchResult.details,
    mapResult: mapResult.details,
  }, null, 2));
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
