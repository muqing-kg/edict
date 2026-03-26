import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildSearchCacheKey,
  enablePluginInConfig,
  formatCliCommand,
  getScopedCredentialValue,
  mergeScopedSearchConfig,
  normalizeCacheKey,
  postTrustedWebToolsJson,
  readCache,
  readProviderEnvValue,
  readCachedSearchPayload,
  readNumberParam,
  readStringParam,
  resolveSearchCount,
  resolveProviderWebSearchPluginConfig,
  resolveWebSearchProviderCredential,
  setProviderWebSearchPluginConfigValue,
  setScopedCredentialValue,
  wrapWebContent,
  writeCache,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const PLUGIN_ID = "openclaw-grok-proxy-web";
const PROVIDER_ID = PLUGIN_ID;
const DOCS_URL = "https://docs.openclaw.ai/tools/web";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-3-search-latest";
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_FETCH_TIMEOUT_SECONDS = 30;
const DEFAULT_MAP_TIMEOUT_SECONDS = 60;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_CACHE_TTL_MINUTES = 15;
const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_FETCH_MAX_CHARS = 12_000;
const DEFAULT_MAP_LIMIT = 50;
const DEFAULT_MAP_MAX_DEPTH = 1;
const DEFAULT_MAP_MAX_BREADTH = 20;
const FETCH_CACHE = new Map();
const MAP_CACHE = new Map();

const API_KEY_ENV_VARS = ["GROK_PROXY_WEB_API_KEY", "XAI_API_KEY"];
const BASE_URL_ENV_VARS = ["GROK_PROXY_WEB_BASE_URL"];
const MODEL_ENV_VARS = ["GROK_PROXY_WEB_MODEL"];
const TIMEOUT_ENV_VARS = ["GROK_PROXY_WEB_TIMEOUT"];
const RETRY_ENV_VARS = ["GROK_PROXY_WEB_RETRY"];
const CACHE_TTL_ENV_VARS = ["GROK_PROXY_WEB_CACHE_TTL"];

const TAVILY_API_KEY_ENV_VARS = ["GROK_PROXY_WEB_TAVILY_API_KEY", "TAVILY_API_KEY"];
const TAVILY_BASE_URL_ENV_VARS = ["GROK_PROXY_WEB_TAVILY_BASE_URL", "TAVILY_BASE_URL"];
const FIRECRAWL_API_KEY_ENV_VARS = ["GROK_PROXY_WEB_FIRECRAWL_API_KEY", "FIRECRAWL_API_KEY"];
const FIRECRAWL_BASE_URL_ENV_VARS = ["GROK_PROXY_WEB_FIRECRAWL_BASE_URL", "FIRECRAWL_BASE_URL"];
const FETCH_TIMEOUT_ENV_VARS = ["GROK_PROXY_WEB_FETCH_TIMEOUT"];
const FETCH_RETRY_ENV_VARS = ["GROK_PROXY_WEB_FETCH_RETRY"];
const FETCH_CACHE_TTL_ENV_VARS = ["GROK_PROXY_WEB_FETCH_CACHE_TTL"];
const MAP_TIMEOUT_ENV_VARS = ["GROK_PROXY_WEB_MAP_TIMEOUT"];
const MAP_RETRY_ENV_VARS = ["GROK_PROXY_WEB_MAP_RETRY"];
const MAP_CACHE_TTL_ENV_VARS = ["GROK_PROXY_WEB_MAP_CACHE_TTL"];

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function asTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampNumber(value, { fallback, min, max, integer = false }) {
  const numeric = toNumber(value);
  if (numeric === undefined) return fallback;
  let normalized = integer ? Math.trunc(numeric) : numeric;
  if (normalized < min) normalized = min;
  if (normalized > max) normalized = max;
  return normalized;
}

function readBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResult(data) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data, null, 2),
    }],
    details: data,
  };
}

function truncateText(text, maxChars) {
  const limit = clampNumber(maxChars, {
    fallback: undefined,
    min: 1,
    max: 200_000,
    integer: true,
  });
  if (!limit || text.length <= limit) {
    return { text, truncated: false };
  }
  const trimmed = text.slice(0, Math.max(0, limit - 1)).trimEnd();
  return {
    text: `${trimmed}…`,
    truncated: true,
  };
}

function markdownToText(markdown) {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, ""))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shouldTryCompatVariant(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("400") ||
    message.includes("404") ||
    message.includes("unsupported") ||
    message.includes("unknown field") ||
    message.includes("validation") ||
    message.includes("search_parameters") ||
    message.includes("web_search_options")
  );
}

function buildSystemPrompt() {
  return [
    "You are OpenClaw web_search for a Grok-compatible provider.",
    "Always use live web search to answer.",
    "Return a concise answer grounded in current web results.",
    "Prefer factual summary over speculation.",
  ].join(" ");
}

function buildUserPrompt({ query, region, safeSearch }) {
  const lines = [query.trim()];
  if (region) lines.push(`Region hint: ${region}`);
  if (safeSearch) lines.push(`SafeSearch hint: ${safeSearch}`);
  return lines.join("\n");
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = asTrimmedString(baseUrl);
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function resolveApiEndpoint(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveFirecrawlEndpoint(baseUrl, path) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/v2$/i.test(normalized)) {
    return `${normalized}${path.replace(/^\/v2/i, "")}`;
  }
  return `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveChatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

function resolvePluginEntryConfig(config) {
  return asRecord(config?.plugins?.entries?.[PLUGIN_ID]?.config) ?? {};
}

function resolvePluginConfig(config) {
  return asRecord(resolvePluginEntryConfig(config).webSearch)
    ?? asRecord(resolveProviderWebSearchPluginConfig(config, PLUGIN_ID))
    ?? {};
}

function resolveSectionConfig(config, key) {
  return asRecord(resolvePluginEntryConfig(config)[key]) ?? {};
}

function resolveMergedSearchConfig(ctx) {
  const pluginConfig = resolvePluginConfig(ctx.config);
  return (
    mergeScopedSearchConfig(ctx.searchConfig, PROVIDER_ID, pluginConfig, {
      mirrorApiKeyToTopLevel: true,
    }) ?? pluginConfig
  );
}

function resolveBaseUrl(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  return normalizeBaseUrl(
    asTrimmedString(searchConfig?.baseUrl) ?? readProviderEnvValue(BASE_URL_ENV_VARS) ?? DEFAULT_BASE_URL,
  );
}

function resolveModel(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  return (
    asTrimmedString(searchConfig?.model) ??
    readProviderEnvValue(MODEL_ENV_VARS) ??
    DEFAULT_MODEL
  );
}

function resolveTimeoutSeconds(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  return clampNumber(
    searchConfig?.timeout ?? readProviderEnvValue(TIMEOUT_ENV_VARS),
    { fallback: DEFAULT_TIMEOUT_SECONDS, min: 1, max: 180 },
  );
}

function resolveRetryCount(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  return clampNumber(
    searchConfig?.retry ?? readProviderEnvValue(RETRY_ENV_VARS),
    { fallback: DEFAULT_RETRY_COUNT, min: 0, max: 5, integer: true },
  );
}

function resolveCacheTtlMs(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  const minutes = clampNumber(
    searchConfig?.cacheTtl ?? readProviderEnvValue(CACHE_TTL_ENV_VARS),
    { fallback: DEFAULT_CACHE_TTL_MINUTES, min: 0, max: 1440 },
  );
  return Math.round(minutes * 60_000);
}

function resolveApiKey(ctx) {
  const searchConfig = resolveMergedSearchConfig(ctx);
  return resolveWebSearchProviderCredential({
    credentialValue: getScopedCredentialValue(searchConfig, PROVIDER_ID),
    path: `plugins.entries.${PLUGIN_ID}.config.webSearch.apiKey`,
    envVars: API_KEY_ENV_VARS,
  });
}

function getConfiguredCredentialValue(config) {
  return resolvePluginConfig(config).apiKey;
}

function setConfiguredCredentialValue(configTarget, value) {
  const current = resolvePluginConfig(configTarget);
  setProviderWebSearchPluginConfigValue(configTarget, PLUGIN_ID, "webSearch", {
    ...current,
    apiKey: value,
  });
}

function applySelectionConfig(config) {
  const cloned = structuredClone(config ?? {});
  const { config: enabledConfig } = enablePluginInConfig(cloned, PLUGIN_ID);
  enabledConfig.tools ??= {};
  enabledConfig.tools.web ??= {};
  enabledConfig.tools.web.search ??= {};
  enabledConfig.tools.web.search.provider = PROVIDER_ID;
  return enabledConfig;
}

function normalizeCitationList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      return asTrimmedString(item.url) ?? asTrimmedString(item.source) ?? asTrimmedString(item.title);
    }
    return undefined;
  }).filter(Boolean))];
}

function normalizeMessageContent(message) {
  if (!message) return undefined;
  if (typeof message.content === "string" && message.content.trim()) return message.content.trim();
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return asTrimmedString(part.text) ?? asTrimmedString(part.content);
        }
        return undefined;
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return text || undefined;
  }
  return undefined;
}

function extractSearchPayload(data, fallbackModel) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const message = asRecord(choice?.message);
  const content = normalizeMessageContent(message) ?? "No response";
  const citations = normalizeCitationList(data?.citations ?? message?.citations);
  return {
    model: asTrimmedString(data?.model) ?? fallbackModel,
    content,
    citations,
  };
}

function buildResultPayload({ query, model, content, citations, tookMs }) {
  return {
    provider: PROVIDER_ID,
    query,
    model,
    tookMs,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: PROVIDER_ID,
      wrapped: true,
    },
    content: wrapWebContent(content, "web_search"),
    citations,
  };
}

function mapSearchContextSize(count) {
  if (count >= 8) return "high";
  if (count >= 4) return "medium";
  return "low";
}

function buildRequestVariants(params) {
  const shared = {
    model: params.model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserPrompt({
          query: params.query,
          region: params.region,
          safeSearch: params.safeSearch,
        }),
      },
    ],
    stream: false,
  };

  return [
    {
      id: "xai-search-parameters",
      body: {
        ...shared,
        search_parameters: {
          mode: "on",
          return_citations: true,
          max_search_results: params.count,
        },
      },
    },
    {
      id: "openai-web-search-options",
      body: {
        ...shared,
        web_search_options: {
          search_context_size: mapSearchContextSize(params.count),
        },
      },
    },
  ];
}

async function requestSearchVariant(params, variant) {
  return postTrustedWebToolsJson(
    {
      url: resolveChatCompletionsUrl(params.baseUrl),
      timeoutSeconds: params.timeoutSeconds,
      apiKey: params.apiKey,
      body: variant.body,
      errorLabel: `Grok proxy web (${variant.id})`,
    },
    async (response) => extractSearchPayload(await response.json(), params.model),
  );
}

async function requestSearchWithFallback(params) {
  const variants = buildRequestVariants(params);
  let lastError;

  for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
    const variant = variants[variantIndex];
    for (let attempt = 0; attempt <= params.retry; attempt += 1) {
      try {
        return await requestSearchVariant(params, variant);
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt >= params.retry;
        const canTryCompat = variantIndex < variants.length - 1 && shouldTryCompatVariant(error);
        if (!isLastAttempt) {
          await sleep(Math.min(1500, 250 * (2 ** attempt)));
          continue;
        }
        if (!canTryCompat) throw error;
      }
    }
  }

  throw lastError ?? new Error("Grok proxy web search failed");
}

async function runSearch(params) {
  const cacheKey = buildSearchCacheKey([
    PROVIDER_ID,
    params.baseUrl,
    params.model,
    params.count,
    params.region,
    params.safeSearch,
    params.query,
  ]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  const startedAt = Date.now();
  const result = await requestSearchWithFallback(params);
  const payload = buildResultPayload({
    query: params.query,
    model: result.model,
    content: result.content,
    citations: result.citations,
    tookMs: Date.now() - startedAt,
  });
  writeCachedSearchPayload(cacheKey, payload, params.cacheTtlMs);
  return payload;
}

function buildMissingCredentialResponse() {
  return {
    error: "missing_grok_proxy_web_api_key",
    message: [
      "web_search (openclaw-grok-proxy-web) needs an API key.",
      `Set ${API_KEY_ENV_VARS.join(" or ")} in the Gateway environment, or configure plugins.entries.${PLUGIN_ID}.config.webSearch.apiKey.`,
      `To make this provider default, set tools.web.search.provider = \"${PROVIDER_ID}\" and restart the gateway.`,
    ].join(" "),
    docs: DOCS_URL,
  };
}

function resolveFeatureSection(config, feature) {
  return resolveSectionConfig(config, feature);
}

function resolveFeatureRuntime(config, feature) {
  const section = resolveFeatureSection(config, feature);
  const timeoutEnvVars = feature === "map" ? MAP_TIMEOUT_ENV_VARS : FETCH_TIMEOUT_ENV_VARS;
  const retryEnvVars = feature === "map" ? MAP_RETRY_ENV_VARS : FETCH_RETRY_ENV_VARS;
  const cacheTtlEnvVars = feature === "map" ? MAP_CACHE_TTL_ENV_VARS : FETCH_CACHE_TTL_ENV_VARS;
  const defaultTimeout = feature === "map" ? DEFAULT_MAP_TIMEOUT_SECONDS : DEFAULT_FETCH_TIMEOUT_SECONDS;
  const timeoutRange = feature === "map"
    ? { min: 1, max: 300 }
    : { min: 1, max: 180 };
  const cacheTtlMinutes = clampNumber(
    section.cacheTtl ?? readProviderEnvValue(cacheTtlEnvVars),
    { fallback: DEFAULT_CACHE_TTL_MINUTES, min: 0, max: 1440 },
  );
  const featureRuntime = {
    timeoutSeconds: clampNumber(
      section.timeout ?? readProviderEnvValue(timeoutEnvVars),
      { fallback: defaultTimeout, min: timeoutRange.min, max: timeoutRange.max },
    ),
    retry: clampNumber(
      section.retry ?? readProviderEnvValue(retryEnvVars),
      { fallback: DEFAULT_RETRY_COUNT, min: 0, max: 5, integer: true },
    ),
    cacheTtlMinutes,
    cacheTtlMs: Math.round(cacheTtlMinutes * 60_000),
  };

  if (feature === "fetch") {
    featureRuntime.maxChars = clampNumber(
      section.maxChars,
      { fallback: DEFAULT_FETCH_MAX_CHARS, min: 100, max: 200_000, integer: true },
    );
    featureRuntime.tavilyExtractDepth = asTrimmedString(section.tavilyExtractDepth) === "advanced"
      ? "advanced"
      : "basic";
    featureRuntime.tavilyIncludeImages = readBoolean(section.tavilyIncludeImages, false);
    featureRuntime.firecrawlOnlyMainContent = readBoolean(section.firecrawlOnlyMainContent, true);
    featureRuntime.firecrawlMaxAgeMs = clampNumber(
      section.firecrawlMaxAgeMs,
      { fallback: 172_800_000, min: 0, max: 2_592_000_000, integer: true },
    );
    featureRuntime.firecrawlProxy = ["auto", "basic", "stealth"].includes(asTrimmedString(section.firecrawlProxy))
      ? asTrimmedString(section.firecrawlProxy)
      : "auto";
    featureRuntime.firecrawlStoreInCache = readBoolean(section.firecrawlStoreInCache, true);
  }

  if (feature === "map") {
    featureRuntime.limit = clampNumber(
      section.limit,
      { fallback: DEFAULT_MAP_LIMIT, min: 1, max: 10_000, integer: true },
    );
    featureRuntime.maxDepth = clampNumber(
      section.maxDepth,
      { fallback: DEFAULT_MAP_MAX_DEPTH, min: 1, max: 5, integer: true },
    );
    featureRuntime.maxBreadth = clampNumber(
      section.maxBreadth,
      { fallback: DEFAULT_MAP_MAX_BREADTH, min: 1, max: 500, integer: true },
    );
    featureRuntime.includeSubdomains = readBoolean(section.includeSubdomains, true);
    featureRuntime.allowExternal = readBoolean(section.allowExternal, false);
  }

  return featureRuntime;
}

function resolveTavilyRuntime(config, feature, overrides = {}) {
  const service = resolveSectionConfig(config, "tavily");
  const featureRuntime = resolveFeatureRuntime(config, feature);
  const minTimeout = feature === "map" ? 10 : 1;
  const maxTimeout = feature === "map" ? 150 : 60;
  const cacheTtlMinutes = clampNumber(
    service.cacheTtl,
    { fallback: featureRuntime.cacheTtlMinutes, min: 0, max: 1440 },
  );
  return {
    apiKey: resolveWebSearchProviderCredential({
      credentialValue: service.apiKey,
      path: `plugins.entries.${PLUGIN_ID}.config.tavily.apiKey`,
      envVars: TAVILY_API_KEY_ENV_VARS,
    }),
    baseUrl: normalizeBaseUrl(
      asTrimmedString(service.baseUrl)
        ?? readProviderEnvValue(TAVILY_BASE_URL_ENV_VARS)
        ?? DEFAULT_TAVILY_BASE_URL,
    ),
    timeoutSeconds: clampNumber(
      overrides.timeoutSeconds ?? service.timeout ?? featureRuntime.timeoutSeconds,
      { fallback: featureRuntime.timeoutSeconds, min: minTimeout, max: maxTimeout },
    ),
    retry: clampNumber(
      overrides.retry ?? service.retry ?? featureRuntime.retry,
      { fallback: featureRuntime.retry, min: 0, max: 5, integer: true },
    ),
    cacheTtlMs: Math.round(cacheTtlMinutes * 60_000),
  };
}

function resolveFirecrawlRuntime(config, feature, overrides = {}) {
  const service = resolveSectionConfig(config, "firecrawl");
  const featureRuntime = resolveFeatureRuntime(config, feature);
  const cacheTtlMinutes = clampNumber(
    service.cacheTtl,
    { fallback: featureRuntime.cacheTtlMinutes, min: 0, max: 1440 },
  );
  return {
    apiKey: resolveWebSearchProviderCredential({
      credentialValue: service.apiKey,
      path: `plugins.entries.${PLUGIN_ID}.config.firecrawl.apiKey`,
      envVars: FIRECRAWL_API_KEY_ENV_VARS,
    }),
    baseUrl: normalizeBaseUrl(
      asTrimmedString(service.baseUrl)
        ?? readProviderEnvValue(FIRECRAWL_BASE_URL_ENV_VARS)
        ?? DEFAULT_FIRECRAWL_BASE_URL,
    ),
    timeoutSeconds: clampNumber(
      overrides.timeoutSeconds ?? service.timeout ?? featureRuntime.timeoutSeconds,
      { fallback: featureRuntime.timeoutSeconds, min: 1, max: 300 },
    ),
    retry: clampNumber(
      overrides.retry ?? service.retry ?? featureRuntime.retry,
      { fallback: featureRuntime.retry, min: 0, max: 5, integer: true },
    ),
    cacheTtlMs: Math.round(cacheTtlMinutes * 60_000),
  };
}

function normalizeComparableUrl(rawUrl) {
  const url = asTrimmedString(rawUrl);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }
}

function ensureHttpUrl(value, label = "url") {
  const raw = readStringParam({ value }, "value", { required: true });
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error(`${label} must use http or https`);
    }
    return parsed.toString();
  } catch (error) {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL`);
  }
}

function selectExtractResult(payload, requestedUrl) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const requested = normalizeComparableUrl(requestedUrl);
  const exactMatch = results.find((item) => normalizeComparableUrl(item?.url) === requested);
  return asRecord(exactMatch) ?? asRecord(results[0]) ?? {};
}

function buildWrappedFetchText(text) {
  return wrapWebContent(text, "web_fetch");
}

function parseTavilyFetchPayload({ payload, url, extractMode, maxChars }) {
  const item = selectExtractResult(payload, url);
  const rawSource = asTrimmedString(item.raw_content)
    ?? asTrimmedString(item.content);
  if (!rawSource) {
    throw new Error("Tavily extract returned no content.");
  }
  const normalizedText = extractMode === "text" ? markdownToText(rawSource) : rawSource;
  const truncated = truncateText(normalizedText, maxChars);
  const wrappedText = buildWrappedFetchText(truncated.text);
  return {
    url,
    finalUrl: asTrimmedString(item.url) ?? url,
    title: asTrimmedString(item.title),
    status: clampNumber(item.status, { fallback: undefined, min: 100, max: 599, integer: true }),
    provider: "tavily",
    extractor: "tavily",
    extractMode,
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      provider: "tavily",
      wrapped: true,
    },
    truncated: truncated.truncated,
    rawLength: normalizedText.length,
    wrappedLength: wrappedText.length,
    text: wrappedText,
    ...(Array.isArray(item.images) ? { images: item.images.map((entry) => String(entry)) } : {}),
    ...(Array.isArray(payload?.failed_results) && payload.failed_results.length > 0
      ? { failedResults: payload.failed_results }
      : {}),
  };
}

function parseFirecrawlFetchPayload({ payload, url, extractMode, maxChars }) {
  const data = asRecord(payload?.data) ?? {};
  const metadata = asRecord(data.metadata) ?? {};
  const markdown = asTrimmedString(data.markdown)
    ?? asTrimmedString(data.content)
    ?? asTrimmedString(data.text);
  if (!markdown) {
    throw new Error("Firecrawl scrape returned no content.");
  }
  const normalizedText = extractMode === "text" ? markdownToText(markdown) : markdown;
  const truncated = truncateText(normalizedText, maxChars);
  const wrappedText = buildWrappedFetchText(truncated.text);
  return {
    url,
    finalUrl: asTrimmedString(metadata.sourceURL)
      ?? asTrimmedString(data.url)
      ?? url,
    title: asTrimmedString(metadata.title)
      ?? asTrimmedString(data.title),
    status: clampNumber(
      metadata.statusCode ?? data.statusCode,
      { fallback: undefined, min: 100, max: 599, integer: true },
    ),
    provider: "firecrawl",
    extractor: "firecrawl",
    extractMode,
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      provider: "firecrawl",
      wrapped: true,
    },
    truncated: truncated.truncated,
    rawLength: normalizedText.length,
    wrappedLength: wrappedText.length,
    text: wrappedText,
    ...(asTrimmedString(payload?.warning) ? { warning: payload.warning } : {}),
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDomainRegex(url, includeSubdomains) {
  const hostname = new URL(url).hostname;
  const escaped = escapeRegex(hostname);
  return includeSubdomains ? `(^|\\.)${escaped}$` : `^${escaped}$`;
}

function normalizeDiscoveredUrls(raw, baseUrl, limit) {
  const seen = new Set();
  const items = [];
  const pushUrl = (candidate) => {
    if (!candidate) return;
    let normalized;
    try {
      normalized = new URL(String(candidate), baseUrl).toString();
    } catch {
      return;
    }
    const comparable = normalizeComparableUrl(normalized);
    if (!comparable || seen.has(comparable)) return;
    seen.add(comparable);
    items.push(normalized);
  };

  const queue = [];
  if (Array.isArray(raw)) queue.push(...raw);
  else if (raw !== undefined) queue.push(raw);

  while (queue.length > 0 && items.length < limit) {
    const current = queue.shift();
    if (typeof current === "string") {
      pushUrl(current);
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = asRecord(current);
    if (!record) continue;
    if (asTrimmedString(record.url)) pushUrl(record.url);
    if (asTrimmedString(record.link)) pushUrl(record.link);
    if (asTrimmedString(record.href)) pushUrl(record.href);
    if (asTrimmedString(record.loc)) pushUrl(record.loc);
    if (asTrimmedString(record.path)) pushUrl(record.path);
    if (Array.isArray(record.links)) queue.push(record.links);
    if (Array.isArray(record.urls)) queue.push(record.urls);
    if (Array.isArray(record.results)) queue.push(record.results);
    if (Array.isArray(record.data)) queue.push(record.data);
  }

  return items.slice(0, limit);
}

function parseMapPayload({ payload, url, provider, limit }) {
  const rawCollections = [
    payload?.results,
    payload?.links,
    payload?.urls,
    payload?.site_map,
    payload?.data,
    payload?.map,
  ];
  const links = rawCollections.flatMap((entry) => Array.isArray(entry) ? [entry] : entry ? [entry] : []);
  const normalizedLinks = normalizeDiscoveredUrls(links, url, limit);
  if (normalizedLinks.length === 0) {
    throw new Error(`${provider} map returned no URLs.`);
  }
  return {
    provider,
    url,
    finalUrl: asTrimmedString(payload?.url) ?? url,
    count: normalizedLinks.length,
    links: normalizedLinks,
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      provider,
      wrapped: false,
    },
    ...(asRecord(payload?.usage) ? { usage: payload.usage } : {}),
  };
}

async function withRetries(label, retry, fn) {
  let lastError;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retry) break;
      await sleep(Math.min(1500, 250 * (2 ** attempt)));
    }
  }
  throw new Error(`${label}: ${String(lastError?.message ?? lastError ?? "unknown failure")}`);
}

async function requestTavilyFetch(config, params) {
  const tavily = resolveTavilyRuntime(config, "fetch", {
    timeoutSeconds: params.timeoutSeconds,
    retry: params.retry,
  });
  const feature = resolveFeatureRuntime(config, "fetch");
  if (!tavily.apiKey) {
    throw new Error(`Missing Tavily API key. Set ${TAVILY_API_KEY_ENV_VARS.join(" or ")} or plugins.entries.${PLUGIN_ID}.config.tavily.apiKey.`);
  }
  return withRetries("Tavily fetch failed", tavily.retry, async () => {
    const payload = await postTrustedWebToolsJson(
      {
        url: resolveApiEndpoint(tavily.baseUrl, "/extract"),
        timeoutSeconds: tavily.timeoutSeconds,
        apiKey: tavily.apiKey,
        body: {
          urls: [params.url],
          format: params.extractMode,
          extract_depth: params.extractDepth ?? feature.tavilyExtractDepth,
          include_images: readBoolean(params.includeImages, feature.tavilyIncludeImages),
          timeout: tavily.timeoutSeconds,
        },
        errorLabel: "Grok Fetch / Tavily",
      },
      async (response) => response.json(),
    );
    return parseTavilyFetchPayload({
      payload,
      url: params.url,
      extractMode: params.extractMode,
      maxChars: params.maxChars,
    });
  });
}

async function requestFirecrawlFetch(config, params) {
  const firecrawl = resolveFirecrawlRuntime(config, "fetch", {
    timeoutSeconds: params.timeoutSeconds,
    retry: params.retry,
  });
  const feature = resolveFeatureRuntime(config, "fetch");
  if (!firecrawl.apiKey) {
    throw new Error(`Missing Firecrawl API key. Set ${FIRECRAWL_API_KEY_ENV_VARS.join(" or ")} or plugins.entries.${PLUGIN_ID}.config.firecrawl.apiKey.`);
  }
  return withRetries("Firecrawl fetch failed", firecrawl.retry, async () => {
    const payload = await postTrustedWebToolsJson(
      {
        url: resolveFirecrawlEndpoint(firecrawl.baseUrl, "/v2/scrape"),
        timeoutSeconds: firecrawl.timeoutSeconds,
        apiKey: firecrawl.apiKey,
        body: {
          url: params.url,
          formats: ["markdown"],
          onlyMainContent: readBoolean(params.onlyMainContent, feature.firecrawlOnlyMainContent),
          timeout: firecrawl.timeoutSeconds * 1000,
          maxAge: clampNumber(
            params.maxAgeMs,
            { fallback: feature.firecrawlMaxAgeMs, min: 0, max: 2_592_000_000, integer: true },
          ),
          proxy: ["auto", "basic", "stealth"].includes(asTrimmedString(params.proxy))
            ? asTrimmedString(params.proxy)
            : feature.firecrawlProxy,
          storeInCache: readBoolean(params.storeInCache, feature.firecrawlStoreInCache),
        },
        errorLabel: "Grok Fetch / Firecrawl",
      },
      async (response) => response.json(),
    );
    return parseFirecrawlFetchPayload({
      payload,
      url: params.url,
      extractMode: params.extractMode,
      maxChars: params.maxChars,
    });
  });
}

async function runFetch(config, rawParams) {
  const feature = resolveFeatureRuntime(config, "fetch");
  const url = ensureHttpUrl(readStringParam(rawParams, "url", { required: true }), "url");
  const extractMode = readStringParam(rawParams, "extractMode") === "text" ? "text" : "markdown";
  const maxChars = clampNumber(
    readNumberParam(rawParams, "maxChars", { integer: true }) ?? feature.maxChars,
    { fallback: feature.maxChars, min: 100, max: 200_000, integer: true },
  );
  const timeoutSeconds = clampNumber(
    readNumberParam(rawParams, "timeoutSeconds") ?? feature.timeoutSeconds,
    { fallback: feature.timeoutSeconds, min: 1, max: 300 },
  );
  const retry = clampNumber(
    readNumberParam(rawParams, "retry", { integer: true }) ?? feature.retry,
    { fallback: feature.retry, min: 0, max: 5, integer: true },
  );

  const tavily = resolveTavilyRuntime(config, "fetch", { timeoutSeconds, retry });
  const firecrawl = resolveFirecrawlRuntime(config, "fetch", { timeoutSeconds, retry });
  if (!tavily.apiKey && !firecrawl.apiKey) {
    throw new Error(
      `grok_fetch needs Tavily or Firecrawl credentials. Configure plugins.entries.${PLUGIN_ID}.config.tavily.apiKey / firecrawl.apiKey, or set ${[...TAVILY_API_KEY_ENV_VARS, ...FIRECRAWL_API_KEY_ENV_VARS].join(" / ")}.`,
    );
  }

  const cacheKey = normalizeCacheKey(JSON.stringify({
    type: "grok-fetch",
    url,
    extractMode,
    maxChars,
    timeoutSeconds,
    retry,
    tavilyBaseUrl: tavily.baseUrl,
    firecrawlBaseUrl: firecrawl.baseUrl,
  }));
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return {
      ...cached.value,
      cached: true,
    };
  }

  const startedAt = Date.now();
  let tavilyError;
  try {
    const result = await requestTavilyFetch(config, {
      url,
      extractMode,
      maxChars,
      timeoutSeconds,
      retry,
      extractDepth: rawParams.extractDepth,
      includeImages: rawParams.includeImages,
    });
    const payload = {
      ...result,
      tool: "grok_fetch",
      providerChain: ["tavily"],
      fallbackUsed: false,
      tookMs: Date.now() - startedAt,
    };
    writeCache(FETCH_CACHE, cacheKey, payload, tavily.cacheTtlMs);
    return payload;
  } catch (error) {
    tavilyError = error;
  }

  if (!firecrawl.apiKey) {
    throw new Error(String(tavilyError?.message ?? tavilyError ?? "Tavily fetch failed"));
  }

  const fallback = await requestFirecrawlFetch(config, {
    url,
    extractMode,
    maxChars,
    timeoutSeconds,
    retry,
    onlyMainContent: rawParams.onlyMainContent,
    maxAgeMs: rawParams.maxAgeMs,
    proxy: rawParams.proxy,
    storeInCache: rawParams.storeInCache,
  });
  const payload = {
    ...fallback,
    tool: "grok_fetch",
    providerChain: ["tavily", "firecrawl"],
    fallbackUsed: true,
    fallbackReason: String(tavilyError?.message ?? tavilyError ?? "Tavily fetch failed"),
    tookMs: Date.now() - startedAt,
  };
  writeCache(FETCH_CACHE, cacheKey, payload, firecrawl.cacheTtlMs);
  return payload;
}

async function requestTavilyMap(config, params) {
  const tavily = resolveTavilyRuntime(config, "map", {
    timeoutSeconds: params.timeoutSeconds,
    retry: params.retry,
  });
  const feature = resolveFeatureRuntime(config, "map");
  if (!tavily.apiKey) {
    throw new Error(`Missing Tavily API key. Set ${TAVILY_API_KEY_ENV_VARS.join(" or ")} or plugins.entries.${PLUGIN_ID}.config.tavily.apiKey.`);
  }
  return withRetries("Tavily map failed", tavily.retry, async () => {
    const payload = await postTrustedWebToolsJson(
      {
        url: resolveApiEndpoint(tavily.baseUrl, "/map"),
        timeoutSeconds: tavily.timeoutSeconds,
        apiKey: tavily.apiKey,
        body: {
          url: params.url,
          max_depth: clampNumber(
            params.depth,
            { fallback: feature.maxDepth, min: 1, max: 5, integer: true },
          ),
          max_breadth: feature.maxBreadth,
          limit: clampNumber(
            params.limit,
            { fallback: feature.limit, min: 1, max: 10_000, integer: true },
          ),
          select_domains: [buildDomainRegex(params.url, params.includeSubdomains)],
          allow_external: readBoolean(params.allowExternal, feature.allowExternal),
          timeout: tavily.timeoutSeconds,
          ...(asTrimmedString(params.instructions) ? { instructions: params.instructions.trim() } : {}),
        },
        errorLabel: "Grok Map / Tavily",
      },
      async (response) => response.json(),
    );
    return parseMapPayload({
      payload,
      url: params.url,
      provider: "tavily",
      limit: clampNumber(
        params.limit,
        { fallback: feature.limit, min: 1, max: 10_000, integer: true },
      ),
    });
  });
}

async function requestFirecrawlMap(config, params) {
  const firecrawl = resolveFirecrawlRuntime(config, "map", {
    timeoutSeconds: params.timeoutSeconds,
    retry: params.retry,
  });
  const feature = resolveFeatureRuntime(config, "map");
  if (!firecrawl.apiKey) {
    throw new Error(`Missing Firecrawl API key. Set ${FIRECRAWL_API_KEY_ENV_VARS.join(" or ")} or plugins.entries.${PLUGIN_ID}.config.firecrawl.apiKey.`);
  }
  return withRetries("Firecrawl map failed", firecrawl.retry, async () => {
    const payload = await postTrustedWebToolsJson(
      {
        url: resolveFirecrawlEndpoint(firecrawl.baseUrl, "/v2/map"),
        timeoutSeconds: firecrawl.timeoutSeconds,
        apiKey: firecrawl.apiKey,
        body: {
          url: params.url,
          includeSubdomains: readBoolean(params.includeSubdomains, feature.includeSubdomains),
          limit: clampNumber(
            params.limit,
            { fallback: feature.limit, min: 1, max: 100_000, integer: true },
          ),
          timeout: firecrawl.timeoutSeconds * 1000,
        },
        errorLabel: "Grok Map / Firecrawl",
      },
      async (response) => response.json(),
    );
    return parseMapPayload({
      payload,
      url: params.url,
      provider: "firecrawl",
      limit: clampNumber(
        params.limit,
        { fallback: feature.limit, min: 1, max: 100_000, integer: true },
      ),
    });
  });
}

async function runMap(config, rawParams) {
  const feature = resolveFeatureRuntime(config, "map");
  const url = ensureHttpUrl(readStringParam(rawParams, "url", { required: true }), "url");
  const limit = clampNumber(
    readNumberParam(rawParams, "limit", { integer: true }) ?? feature.limit,
    { fallback: feature.limit, min: 1, max: 100_000, integer: true },
  );
  const timeoutSeconds = clampNumber(
    readNumberParam(rawParams, "timeoutSeconds") ?? feature.timeoutSeconds,
    { fallback: feature.timeoutSeconds, min: 1, max: 300 },
  );
  const retry = clampNumber(
    readNumberParam(rawParams, "retry", { integer: true }) ?? feature.retry,
    { fallback: feature.retry, min: 0, max: 5, integer: true },
  );
  const includeSubdomains = typeof rawParams.includeSubdomains === "boolean"
    ? rawParams.includeSubdomains
    : feature.includeSubdomains;
  const depth = clampNumber(
    readNumberParam(rawParams, "depth", { integer: true }) ?? feature.maxDepth,
    { fallback: feature.maxDepth, min: 1, max: 5, integer: true },
  );

  const tavily = resolveTavilyRuntime(config, "map", { timeoutSeconds, retry });
  const firecrawl = resolveFirecrawlRuntime(config, "map", { timeoutSeconds, retry });
  if (!tavily.apiKey && !firecrawl.apiKey) {
    throw new Error(
      `grok_map needs Tavily or Firecrawl credentials. Configure plugins.entries.${PLUGIN_ID}.config.tavily.apiKey / firecrawl.apiKey, or set ${[...TAVILY_API_KEY_ENV_VARS, ...FIRECRAWL_API_KEY_ENV_VARS].join(" / ")}.`,
    );
  }

  const cacheKey = normalizeCacheKey(JSON.stringify({
    type: "grok-map",
    url,
    limit,
    timeoutSeconds,
    retry,
    depth,
    includeSubdomains,
    tavilyBaseUrl: tavily.baseUrl,
    firecrawlBaseUrl: firecrawl.baseUrl,
  }));
  const cached = readCache(MAP_CACHE, cacheKey);
  if (cached) {
    return {
      ...cached.value,
      cached: true,
    };
  }

  const startedAt = Date.now();
  let tavilyError;
  try {
    const result = await requestTavilyMap(config, {
      url,
      limit,
      depth,
      includeSubdomains,
      timeoutSeconds,
      retry,
      instructions: readStringParam(rawParams, "instructions", { required: false }),
      allowExternal: rawParams.allowExternal,
    });
    const payload = {
      ...result,
      tool: "grok_map",
      depth,
      includeSubdomains,
      providerChain: ["tavily"],
      fallbackUsed: false,
      tookMs: Date.now() - startedAt,
    };
    writeCache(MAP_CACHE, cacheKey, payload, tavily.cacheTtlMs);
    return payload;
  } catch (error) {
    tavilyError = error;
  }

  if (!firecrawl.apiKey) {
    throw new Error(String(tavilyError?.message ?? tavilyError ?? "Tavily map failed"));
  }

  const fallback = await requestFirecrawlMap(config, {
    url,
    limit,
    includeSubdomains,
    timeoutSeconds,
    retry,
  });
  const payload = {
    ...fallback,
    tool: "grok_map",
    depth,
    includeSubdomains,
    providerChain: ["tavily", "firecrawl"],
    fallbackUsed: true,
    fallbackReason: String(tavilyError?.message ?? tavilyError ?? "Tavily map failed"),
    tookMs: Date.now() - startedAt,
  };
  writeCache(MAP_CACHE, cacheKey, payload, firecrawl.cacheTtlMs);
  return payload;
}

function buildFetchTool(api) {
  return {
    name: "grok_fetch",
    label: "Grok Fetch",
    description: "Fetch a URL via Tavily first, then fall back to Firecrawl when needed. Supports markdown/text output.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch.",
        },
        extractMode: {
          type: "string",
          enum: ["markdown", "text"],
          description: "Extraction mode. Default: markdown.",
        },
        maxChars: {
          type: "integer",
          minimum: 100,
          description: "Maximum characters to return.",
        },
        timeoutSeconds: {
          type: "number",
          minimum: 1,
          description: "Override timeout for this fetch request.",
        },
        retry: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Override retry count for this fetch request.",
        },
        extractDepth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Tavily extract depth override.",
        },
        includeImages: {
          type: "boolean",
          description: "Whether Tavily should include discovered image URLs.",
        },
        onlyMainContent: {
          type: "boolean",
          description: "Whether Firecrawl should keep only main content during fallback.",
        },
        maxAgeMs: {
          type: "integer",
          minimum: 0,
          description: "Firecrawl cache age override for fallback, in milliseconds.",
        },
        proxy: {
          type: "string",
          enum: ["auto", "basic", "stealth"],
          description: "Firecrawl proxy mode override for fallback.",
        },
        storeInCache: {
          type: "boolean",
          description: "Whether Firecrawl fallback should store the scrape in Firecrawl cache.",
        },
      },
    },
    async execute(_toolCallId, rawParams) {
      try {
        return jsonResult(await runFetch(api.config ?? {}, rawParams ?? {}));
      } catch (error) {
        return jsonResult({
          error: "grok_fetch_failed",
          message: String(error?.message ?? error ?? "grok_fetch failed"),
          docs: DOCS_URL,
        });
      }
    },
  };
}

function buildMapTool(api) {
  return {
    name: "grok_map",
    label: "Grok Map",
    description: "Discover a site's structure via Tavily map first, with optional Firecrawl fallback.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS root URL to map.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100000,
          description: "Maximum number of URLs to return.",
        },
        includeSubdomains: {
          type: "boolean",
          description: "Whether subdomains should be included in the map scope.",
        },
        depth: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Maximum Tavily map depth.",
        },
        instructions: {
          type: "string",
          description: "Optional Tavily map instructions for focused discovery.",
        },
        allowExternal: {
          type: "boolean",
          description: "Whether Tavily map is allowed to include external links.",
        },
        timeoutSeconds: {
          type: "number",
          minimum: 1,
          description: "Override timeout for this map request.",
        },
        retry: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Override retry count for this map request.",
        },
      },
    },
    async execute(_toolCallId, rawParams) {
      try {
        return jsonResult(await runMap(api.config ?? {}, rawParams ?? {}));
      } catch (error) {
        return jsonResult({
          error: "grok_map_failed",
          message: String(error?.message ?? error ?? "grok_map failed"),
          docs: DOCS_URL,
        });
      }
    },
  };
}

function buildProvider() {
  return {
    id: PROVIDER_ID,
    label: "Grok Proxy Web",
    hint: "Third-party OpenAI/xAI-compatible Grok web search via chat/completions",
    requiresCredential: true,
    credentialLabel: "Grok-compatible API key",
    envVars: API_KEY_ENV_VARS,
    placeholder: "sk-...",
    signupUrl: "https://docs.x.ai/",
    docsUrl: DOCS_URL,
    autoDetectOrder: 35,
    credentialPath: `plugins.entries.${PLUGIN_ID}.config.webSearch.apiKey`,
    inactiveSecretPaths: [`plugins.entries.${PLUGIN_ID}.config.webSearch.apiKey`],
    getCredentialValue: (searchConfig) => getScopedCredentialValue(searchConfig, PROVIDER_ID),
    setCredentialValue: (searchConfigTarget, value) => setScopedCredentialValue(searchConfigTarget, PROVIDER_ID, value),
    getConfiguredCredentialValue,
    setConfiguredCredentialValue,
    applySelectionConfig,
    createTool: (ctx) => ({
      description:
        "Search the web via a third-party Grok/OpenAI-compatible endpoint. Supports baseUrl/apiKey/model overrides from plugin config.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Search query string.",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Number of search results to ground against (1-10).",
          },
          region: {
            type: "string",
            description: "Optional region hint. Passed as prompt context today.",
          },
          safeSearch: {
            type: "string",
            enum: ["strict", "moderate", "off"],
            description: "Optional SafeSearch hint. Passed as prompt context today.",
          },
        },
      },
      execute: async (args) => {
        const apiKey = resolveApiKey(ctx);
        if (!apiKey) return buildMissingCredentialResponse();

        const query = readStringParam(args, "query", { required: true });
        const count = resolveSearchCount(readNumberParam(args, "count", { integer: true }), 5);
        const region = readStringParam(args, "region", { required: false });
        const safeSearch = readStringParam(args, "safeSearch", { required: false });

        try {
          return await runSearch({
            query,
            count,
            region,
            safeSearch,
            apiKey,
            baseUrl: resolveBaseUrl(ctx),
            model: resolveModel(ctx),
            timeoutSeconds: resolveTimeoutSeconds(ctx),
            retry: resolveRetryCount(ctx),
            cacheTtlMs: resolveCacheTtlMs(ctx),
          });
        } catch (error) {
          return {
            error: "grok_proxy_web_search_failed",
            message: String(error?.message ?? error ?? "Grok proxy web search failed"),
            docs: DOCS_URL,
            help: [
              `Check plugins.entries.${PLUGIN_ID}.config.webSearch.baseUrl/model/apiKey.`,
              `If you just linked the plugin, restart the gateway so ${PROVIDER_ID} becomes active.`,
              `Config hint: ${formatCliCommand(`tools.web.search.provider=\"${PROVIDER_ID}\"`)}`,
            ].join(" "),
          };
        }
      },
    }),
  };
}

export const __testing = {
  applySelectionConfig,
  buildDomainRegex,
  buildRequestVariants,
  buildResultPayload,
  extractSearchPayload,
  markdownToText,
  normalizeBaseUrl,
  normalizeComparableUrl,
  normalizeDiscoveredUrls,
  parseFirecrawlFetchPayload,
  parseMapPayload,
  parseTavilyFetchPayload,
  resolveChatCompletionsUrl,
  resolvePluginConfig,
  resolvePluginEntryConfig,
  resolveFeatureRuntime,
  resolveFirecrawlRuntime,
  resolveTavilyRuntime,
};

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-grok-proxy-web",
  description:
    "Native OpenClaw plugin that registers a third-party Grok/OpenAI-compatible web_search provider plus grok_fetch / grok_map tooling with Tavily-first, Firecrawl-fallback boundaries.",
  register(api) {
    api.registerWebSearchProvider(buildProvider());
    api.registerTool(buildFetchTool(api), { name: "grok_fetch" });
    api.registerTool(buildMapTool(api), { name: "grok_map" });
  },
});
