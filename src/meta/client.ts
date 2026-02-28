import { FbCliError } from "../errors/fbcli-error.js";

export type QueryParams = Record<string, string | number | boolean | object | undefined>;

export type MetaApiListResponse = {
  data?: unknown[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
  [key: string]: unknown;
};

export type PaginatedResult = {
  data: unknown[];
  paging: {
    pagesFetched: number;
    before?: string;
    after?: string;
    hasNextPage: boolean;
  };
};

export interface MetaApiClient {
  get(path: string, params?: QueryParams): Promise<unknown>;
  getAllPages?(path: string, params?: QueryParams, maxPages?: number): Promise<PaginatedResult>;
}

type AdsApiAccessTier = "development_access" | "standard_access";

type ClientInternals = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export type GraphApiRateLimitOptions = {
  enabled: boolean;
  adsApiAccessTier: AdsApiAccessTier;
  scoreWindowSeconds: number;
  developmentMaxScore: number;
  standardMaxScore: number;
  developmentBlockSeconds: number;
  standardBlockSeconds: number;
  mutationQpsLimit: number;
  retryMaxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitterMs: number;
};

export type GraphApiClientOptions = {
  accessToken?: string;
  apiVersion?: string;
  baseUrl?: string;
  rateLimit?: Partial<GraphApiRateLimitOptions>;
  internals?: Partial<ClientInternals>;
};

type RateScoreBucket = {
  score: number;
  updatedAtMs: number;
};

type ResponseErrorPayload = {
  error?: {
    message: string;
    code?: number;
    error_subcode?: number;
  };
};

const RATE_LIMIT_ERROR_CODES = new Set([4, 17, 613, 80000, 80003, 80004, 80014]);
const RATE_LIMIT_SUBCODES = new Set([2446079, 1487742, 5044001, 1504022, 1504039, 1885172, 1487632, 1487225]);

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseTier(value: string | undefined, fallback: AdsApiAccessTier): AdsApiAccessTier {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "standard" || normalized === "standard_access") {
    return "standard_access";
  }

  if (normalized === "development" || normalized === "development_access") {
    return "development_access";
  }

  return fallback;
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findFirstNumericByKey(input: unknown, targetKeys: string[]): number | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const stack: unknown[] = [input];
  const visited = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (targetKeys.includes(key) && typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }

  return undefined;
}

function responseHeaderSnapshot(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = ["retry-after", "x-ad-account-usage", "x-business-use-case", "x-fb-ads-insights-throttle"];

  for (const key of keys) {
    const value = headers.get(key);
    if (value) {
      result[key] = value;
    }
  }

  return result;
}

function extractAdAccountId(path: string): string | undefined {
  const match = path.match(/^\/(act_[^/?]+)/i);
  if (!match) {
    return undefined;
  }

  return match[1]?.toLowerCase();
}

function isMutationEndpoint(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(normalizedMethod)) {
    return false;
  }

  if (/^\/(adgroup|adcampaign|campaigngroup)$/i.test(path)) {
    return true;
  }

  return /^\/act_[^/]+\/(ads|adsets|campaigns)$/i.test(path);
}

export class GraphApiClient implements MetaApiClient {
  private readonly accessToken?: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly rateLimit: GraphApiRateLimitOptions;
  private readonly internals: ClientInternals;
  private readonly scoreBucketsByAccount = new Map<string, RateScoreBucket>();
  private readonly mutationRequestTimesByAccount = new Map<string, number[]>();

  constructor(options: GraphApiClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion ?? "v25.0";
    this.baseUrl = options.baseUrl ?? "https://graph.facebook.com";

    const defaults: GraphApiRateLimitOptions = {
      enabled: parseBooleanEnv(process.env.FBCLI_RATE_LIMIT_ENABLED, true),
      adsApiAccessTier: parseTier(process.env.FBCLI_ADS_API_ACCESS_TIER, "development_access"),
      scoreWindowSeconds: parsePositiveNumber(process.env.FBCLI_RATE_SCORE_WINDOW_SECONDS, 300),
      developmentMaxScore: parsePositiveNumber(process.env.FBCLI_RATE_DEV_MAX_SCORE, 60),
      standardMaxScore: parsePositiveNumber(process.env.FBCLI_RATE_STANDARD_MAX_SCORE, 9000),
      developmentBlockSeconds: parsePositiveNumber(process.env.FBCLI_RATE_DEV_BLOCK_SECONDS, 300),
      standardBlockSeconds: parsePositiveNumber(process.env.FBCLI_RATE_STANDARD_BLOCK_SECONDS, 60),
      mutationQpsLimit: parsePositiveNumber(process.env.FBCLI_MUTATION_QPS_LIMIT, 100),
      retryMaxAttempts: parsePositiveNumber(process.env.FBCLI_RATE_RETRY_MAX_ATTEMPTS, 5),
      retryBaseMs: parsePositiveNumber(process.env.FBCLI_RATE_RETRY_BASE_MS, 1000),
      retryMaxMs: parsePositiveNumber(process.env.FBCLI_RATE_RETRY_MAX_MS, 120000),
      retryJitterMs: parsePositiveNumber(process.env.FBCLI_RATE_RETRY_JITTER_MS, 250),
    };

    this.rateLimit = {
      ...defaults,
      ...options.rateLimit,
    };

    this.internals = {
      now: options.internals?.now ?? (() => Date.now()),
      sleep: options.internals?.sleep ?? (async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))),
      random: options.internals?.random ?? (() => Math.random()),
    };
  }

  async get(path: string, params: QueryParams = {}): Promise<unknown> {
    return await this.request("GET", path, params);
  }

  async getAllPages(path: string, params: QueryParams = {}, maxPages = 50): Promise<PaginatedResult> {
    const baseParams = { ...params };
    const initialAfter = typeof baseParams.after === "string" ? baseParams.after : undefined;
    delete baseParams.after;

    let after = initialAfter;
    let pagesFetched = 0;
    let beforeCursor: string | undefined;
    let afterCursor: string | undefined;
    const rows: unknown[] = [];

    while (pagesFetched < maxPages) {
      const pageParams: QueryParams = { ...baseParams };
      if (after) {
        pageParams.after = after;
      }

      const payload = (await this.get(path, pageParams)) as MetaApiListResponse;
      pagesFetched += 1;

      if (Array.isArray(payload.data)) {
        rows.push(...payload.data);
      }

      if (!beforeCursor) {
        beforeCursor = payload.paging?.cursors?.before;
      }
      afterCursor = payload.paging?.cursors?.after;

      const nextAfter = payload.paging?.cursors?.after;
      const hasNext = Boolean(payload.paging?.next) && Boolean(nextAfter) && nextAfter !== after;
      if (!hasNext) {
        return {
          data: rows,
          paging: {
            pagesFetched,
            before: beforeCursor,
            after: afterCursor,
            hasNextPage: false,
          },
        };
      }

      after = nextAfter;
    }

    return {
      data: rows,
      paging: {
        pagesFetched,
        before: beforeCursor,
        after: afterCursor,
        hasNextPage: true,
      },
    };
  }

  private async request(method: string, path: string, params: QueryParams = {}): Promise<unknown> {
    if (!this.accessToken) {
      throw new FbCliError("MISSING_TOKEN", "Missing access token. Set FBCLI_ACCESS_TOKEN.");
    }

    const requestUrl = this.buildRequestUrl(path, params);
    const maxAttempts = Math.max(1, Math.floor(this.rateLimit.retryMaxAttempts));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.applyLocalRateLimit(method, path);

      const response = await fetch(requestUrl, {
        method,
        headers: {
          Accept: "application/json",
        },
      });

      const payload = (await this.parseResponsePayload(response)) as ResponseErrorPayload;
      if (response.ok && !payload.error) {
        return payload;
      }

      const errorMessage = payload.error?.message ?? "Meta API request failed.";
      const metaCode = payload.error?.code;
      const metaSubcode = payload.error?.error_subcode;
      const headerSnapshot = responseHeaderSnapshot(response.headers);
      const isRateLimited = this.isRateLimitError(response.status, metaCode, metaSubcode, errorMessage);

      if (isRateLimited && attempt < maxAttempts) {
        const waitMs = this.computeRetryDelayMs({
          attempt,
          metaCode,
          metaSubcode,
          headers: response.headers,
        });

        await this.internals.sleep(waitMs);
        continue;
      }

      throw new FbCliError("META_API_ERROR", errorMessage, {
        path,
        status: response.status,
        metaCode,
        metaSubcode,
        attempt,
        maxAttempts,
        rateLimitDetected: isRateLimited,
        rateLimitHeaders: headerSnapshot,
      });
    }

    throw new FbCliError("META_API_ERROR", "Meta API request failed after retry attempts.", {
      path,
      maxAttempts,
    });
  }

  private buildRequestUrl(path: string, params: QueryParams): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "undefined") {
        continue;
      }

      if (typeof value === "object") {
        searchParams.set(key, JSON.stringify(value));
      } else {
        searchParams.set(key, String(value));
      }
    }

    searchParams.set("access_token", this.accessToken ?? "");
    return `${this.baseUrl}/${this.apiVersion}${path}?${searchParams.toString()}`;
  }

  private async parseResponsePayload(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private async applyLocalRateLimit(method: string, path: string): Promise<void> {
    if (!this.rateLimit.enabled) {
      return;
    }

    const adAccountId = extractAdAccountId(path);
    if (adAccountId) {
      await this.applyAccountScoreRateLimit(adAccountId, method);
    }

    if (adAccountId && isMutationEndpoint(method, path)) {
      await this.applyMutationQpsRateLimit(adAccountId);
    }
  }

  private async applyAccountScoreRateLimit(adAccountId: string, method: string): Promise<void> {
    const scoreWeight = method.toUpperCase() === "GET" ? 1 : 3;
    const maxScore = this.currentTierMaxScore();
    const decayPerSecond = maxScore / this.rateLimit.scoreWindowSeconds;

    if (decayPerSecond <= 0) {
      return;
    }

    while (true) {
      const nowMs = this.internals.now();
      const bucket = this.scoreBucketsByAccount.get(adAccountId) ?? {
        score: 0,
        updatedAtMs: nowMs,
      };

      const elapsedSeconds = Math.max(0, nowMs - bucket.updatedAtMs) / 1000;
      bucket.score = Math.max(0, bucket.score - elapsedSeconds * decayPerSecond);
      bucket.updatedAtMs = nowMs;

      const projectedScore = bucket.score + scoreWeight;
      if (projectedScore <= maxScore) {
        bucket.score = projectedScore;
        this.scoreBucketsByAccount.set(adAccountId, bucket);
        return;
      }

      const overflow = projectedScore - maxScore;
      const overflowWaitMs = Math.ceil((overflow / decayPerSecond) * 1000);
      const tierBlockMs = this.currentTierBlockSeconds() * 1000;
      const waitMs = Math.max(overflowWaitMs, tierBlockMs > 0 ? tierBlockMs : 0);

      await this.internals.sleep(waitMs);
    }
  }

  private async applyMutationQpsRateLimit(adAccountId: string): Promise<void> {
    const qpsLimit = Math.max(1, Math.floor(this.rateLimit.mutationQpsLimit));
    const nowMs = this.internals.now();
    const existing = this.mutationRequestTimesByAccount.get(adAccountId) ?? [];
    const recent = existing.filter((timestamp) => nowMs - timestamp < 1000);

    if (recent.length >= qpsLimit) {
      const oldestTimestamp = recent[0] ?? nowMs;
      const waitMs = Math.max(1, 1000 - (nowMs - oldestTimestamp));
      await this.internals.sleep(waitMs);

      const afterWaitNowMs = this.internals.now();
      const afterWait = (this.mutationRequestTimesByAccount.get(adAccountId) ?? []).filter(
        (timestamp) => afterWaitNowMs - timestamp < 1000,
      );
      afterWait.push(afterWaitNowMs);
      this.mutationRequestTimesByAccount.set(adAccountId, afterWait);
      return;
    }

    recent.push(nowMs);
    this.mutationRequestTimesByAccount.set(adAccountId, recent);
  }

  private currentTierMaxScore(): number {
    return this.rateLimit.adsApiAccessTier === "standard_access"
      ? this.rateLimit.standardMaxScore
      : this.rateLimit.developmentMaxScore;
  }

  private currentTierBlockSeconds(): number {
    return this.rateLimit.adsApiAccessTier === "standard_access"
      ? this.rateLimit.standardBlockSeconds
      : this.rateLimit.developmentBlockSeconds;
  }

  private isRateLimitError(
    httpStatus: number,
    metaCode: number | undefined,
    metaSubcode: number | undefined,
    message: string,
  ): boolean {
    if (httpStatus === 429) {
      return true;
    }

    if (typeof metaCode === "number" && RATE_LIMIT_ERROR_CODES.has(metaCode)) {
      return true;
    }

    if (typeof metaSubcode === "number" && RATE_LIMIT_SUBCODES.has(metaSubcode)) {
      return true;
    }

    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("too many calls") ||
      normalizedMessage.includes("request limit reached")
    );
  }

  private computeRetryDelayMs(input: {
    attempt: number;
    metaCode?: number;
    metaSubcode?: number;
    headers: Headers;
  }): number {
    const exponentialDelayMs = Math.min(
      this.rateLimit.retryMaxMs,
      this.rateLimit.retryBaseMs * 2 ** Math.max(0, input.attempt - 1),
    );

    const retryAfterSeconds = Number.parseFloat(input.headers.get("retry-after") ?? "");
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds * 1000) : 0;

    const adUsage = parseJson(input.headers.get("x-ad-account-usage"));
    const adUsageResetSeconds = findFirstNumericByKey(adUsage, ["reset_time_duration"]);
    const adUsageResetMs = typeof adUsageResetSeconds === "number" && adUsageResetSeconds > 0
      ? Math.ceil(adUsageResetSeconds * 1000)
      : 0;

    const businessUseCase = parseJson(input.headers.get("x-business-use-case"));
    const businessUseCaseResetSeconds = findFirstNumericByKey(businessUseCase, ["estimated_time_to_regain_access"]);
    const businessUseCaseResetMs =
      typeof businessUseCaseResetSeconds === "number" && businessUseCaseResetSeconds > 0
        ? Math.ceil(businessUseCaseResetSeconds * 1000)
        : 0;

    let subcodeDelayMs = 0;
    if (input.metaSubcode === 2446079 || input.metaSubcode === 1487742) {
      subcodeDelayMs = this.currentTierBlockSeconds() * 1000;
    } else if (input.metaSubcode === 5044001) {
      subcodeDelayMs = 1000;
    } else if (input.metaSubcode === 1885172 || input.metaSubcode === 1487632 || input.metaSubcode === 1487225) {
      subcodeDelayMs = 60_000;
    }

    const baseDelayMs = Math.max(exponentialDelayMs, retryAfterMs, adUsageResetMs, businessUseCaseResetMs, subcodeDelayMs);
    const jitterMs = this.rateLimit.retryJitterMs > 0 ? Math.floor(this.internals.random() * this.rateLimit.retryJitterMs) : 0;

    return Math.max(1, baseDelayMs + jitterMs);
  }
}
