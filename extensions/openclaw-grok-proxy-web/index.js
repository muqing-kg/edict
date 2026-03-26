import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildSearchCacheKey,
  enablePluginInConfig,
  formatCliCommand,
  getScopedCredentialValue,
  mergeScopedSearchConfig,
  postTrustedWebToolsJson,
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
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const PLUGIN_ID = "openclaw-grok-proxy-web";
const PROVIDER_ID = PLUGIN_ID;
const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-3-search-latest";
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_CACHE_TTL_MINUTES = 15;
const DOCS_URL = "https://docs.openclaw.ai/tools/web";
const API_KEY_ENV_VARS = ["GROK_PROXY_WEB_API_KEY", "XAI_API_KEY"];
const BASE_URL_ENV_VARS = ["GROK_PROXY_WEB_BASE_URL"];
const MODEL_ENV_VARS = ["GROK_PROXY_WEB_MODEL"];
const TIMEOUT_ENV_VARS = ["GROK_PROXY_WEB_TIMEOUT"];
const RETRY_ENV_VARS = ["GROK_PROXY_WEB_RETRY"];
const CACHE_TTL_ENV_VARS = ["GROK_PROXY_WEB_CACHE_TTL"];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function resolveChatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

function resolvePluginConfig(config) {
  return asRecord(resolveProviderWebSearchPluginConfig(config, PLUGIN_ID)) ?? {};
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
  buildRequestVariants,
  buildResultPayload,
  extractSearchPayload,
  normalizeBaseUrl,
  resolveChatCompletionsUrl,
  resolvePluginConfig,
};

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-grok-proxy-web",
  description:
    "Native OpenClaw plugin that registers a third-party Grok/OpenAI-compatible web_search provider and leaves phase boundaries for fetch/map/diagnostics takeover.",
  register(api) {
    api.registerWebSearchProvider(buildProvider());
  },
});
