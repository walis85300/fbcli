import { Command } from "commander";
import { type StructuredError, toStructuredError } from "../errors/fbcli-error.js";
import {
  type MetaApiClient,
  type MetaApiListResponse,
  type PaginatedResult,
  type QueryParams,
} from "../meta/client.js";
import { resolveGraphPath } from "../meta/path-resolver.js";
import {
  inferGraphNodeTypeFromId,
  listGraphEdges,
  listGraphNodes,
  parseGraphNodeType,
  type GraphNodeType,
} from "../schema/graph-resources.js";
import { computeKpis } from "../insights/kpis.js";
import { buildManifestSelectionPayload, type HelpJsonSelection } from "../agent/manifest.js";
import {
  DEFAULT_AUTH_SCOPES,
  DEFAULT_REDIRECT_URI,
  createAuthWorkflow,
  type AuthWorkflow,
} from "../auth-workflow.js";

type CliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type SortMetric = "spend" | "ctr" | "cpc";
type SortOrder = "asc" | "desc";

type CliDependencies = {
  authWorkflow: AuthWorkflow;
};

export type RunCliResult = {
  exitCode: number;
  error?: StructuredError;
};

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
};

const DEFAULT_INSIGHTS_FIELDS = ["impressions", "clicks", "spend"];
const DEFAULT_CAMPAIGN_DEEP_DIVE_FIELDS = [
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "spend",
  "reach",
  "frequency",
];
const DEFAULT_ADSET_DEEP_DIVE_FIELDS = [
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "spend",
  "reach",
  "frequency",
];
const DEFAULT_CREATIVE_DEEP_DIVE_FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "spend",
  "reach",
  "frequency",
];

function parseCsv(csvValue?: string): string | undefined {
  if (!csvValue) {
    return undefined;
  }

  return csvValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");
}

function parseCsvList(csvValue?: string): string[] | undefined {
  const parsed = parseCsv(csvValue);
  if (!parsed) {
    return undefined;
  }

  return parsed.split(",");
}

function writeJson(io: CliIo, payload: unknown): void {
  io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
}

function buildKpiOutput(
  kpis: ReturnType<typeof computeKpis>,
  summaryOnly: boolean,
  totalsOnly: boolean,
): Record<string, unknown> {
  if (totalsOnly) {
    return {
      totals: kpis.totals,
    };
  }

  if (!summaryOnly) {
    return kpis as unknown as Record<string, unknown>;
  }

  return {
    rowCount: kpis.rowCount,
    totals: kpis.totals,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseSortMetric(value: string | undefined): SortMetric {
  if (value === "ctr" || value === "cpc" || value === "spend") {
    return value;
  }

  return "spend";
}

function parseSortOrder(value: string | undefined): SortOrder {
  if (value === "asc" || value === "desc") {
    return value;
  }

  return "desc";
}

function parseMetricValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function resolveNodeTypeOrInfer(id: string, nodeTypeInput?: string): GraphNodeType {
  if (nodeTypeInput) {
    return parseGraphNodeType(nodeTypeInput);
  }

  return inferGraphNodeTypeFromId(id);
}

function buildInsightsParams(options: {
  fields: string;
  breakdowns?: string;
  actionBreakdowns?: string;
  level?: string;
  datePreset?: string;
  since?: string;
  until?: string;
  sort?: string;
  filtering?: string;
  after?: string;
}): QueryParams {
  const params: QueryParams = {
    fields: parseCsv(options.fields) ?? DEFAULT_INSIGHTS_FIELDS.join(","),
    breakdowns: parseCsv(options.breakdowns),
    action_breakdowns: parseCsv(options.actionBreakdowns),
    level: options.level,
    date_preset: options.datePreset,
    sort: options.sort,
    after: options.after,
  };

  if (options.since && options.until) {
    params.time_range = { since: options.since, until: options.until };
  }

  if (options.filtering) {
    params.filtering = JSON.parse(options.filtering) as object;
  }

  return params;
}

async function fetchAllPages(
  client: MetaApiClient,
  path: string,
  params: QueryParams,
  maxPages: number,
  allPages: boolean,
): Promise<PaginatedResult> {
  if (client.getAllPages) {
    return client.getAllPages(path, params, maxPages);
  }

  const baseParams = { ...params };
  let after = typeof baseParams.after === "string" ? baseParams.after : undefined;
  delete baseParams.after;

  let pagesFetched = 0;
  let beforeCursor: string | undefined;
  let afterCursor: string | undefined;
  const rows: unknown[] = [];

  while (pagesFetched < maxPages) {
    const pageParams: QueryParams = { ...baseParams };
    if (after) {
      pageParams.after = after;
    }

    const payload = (await client.get(path, pageParams)) as MetaApiListResponse;
    pagesFetched += 1;

    if (Array.isArray(payload.data)) {
      rows.push(...payload.data);
    }

    if (!beforeCursor) {
      beforeCursor = payload.paging?.cursors?.before;
    }
    afterCursor = payload.paging?.cursors?.after;

    const hasNext =
      allPages &&
      Boolean(payload.paging?.next) &&
      Boolean(payload.paging?.cursors?.after) &&
      payload.paging?.cursors?.after !== after;
    if (!hasNext) {
      return {
        data: rows,
        paging: {
          pagesFetched,
          before: beforeCursor,
          after: afterCursor,
          hasNextPage: Boolean(payload.paging?.next),
        },
      };
    }

    after = payload.paging?.cursors?.after;
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

function buildSortedRows(
  rows: unknown[],
  sortMetric: SortMetric,
  sortOrder: SortOrder,
): Array<{ row: Record<string, unknown>; metrics: { ctr: number | null; cpc: number | null; spend: number } }> {
  const typedRows = rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);

  const withMetrics = typedRows.map((row) => {
    const impressions = parseMetricValue(row.impressions);
    const clicks = parseMetricValue(row.clicks);
    const spend = parseMetricValue(row.spend);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpc = clicks > 0 ? spend / clicks : null;

    return {
      row,
      metrics: {
        spend,
        ctr,
        cpc,
      },
    };
  });

  const direction = sortOrder === "asc" ? 1 : -1;
  withMetrics.sort((left, right) => {
    const leftValue = left.metrics[sortMetric] ?? (sortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const rightValue =
      right.metrics[sortMetric] ?? (sortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);

    if (leftValue === rightValue) {
      return 0;
    }

    return leftValue > rightValue ? direction : -direction;
  });

  return withMetrics;
}

async function runDeepDiveReport(
  client: MetaApiClient,
  io: CliIo,
  options: {
    commandName: string;
    account: string;
    fields: string;
    level: "campaign" | "adset" | "ad";
    breakdowns?: string;
    datePreset?: string;
    since?: string;
    until?: string;
    after?: string;
    maxPages?: string;
    allPages?: boolean;
    highlightIdField: string;
    highlightNameField: string;
    top?: string;
    minImpressions?: string;
    sortBy?: string;
    sortOrder?: string;
    summaryOnly?: boolean;
    totalsOnly?: boolean;
  },
): Promise<void> {
  const resolvedPath = resolveGraphPath({
    nodeType: "ad_account",
    id: options.account,
    edge: "insights",
    method: "GET",
  });

  const params = buildInsightsParams({
    fields: options.fields,
    level: options.level,
    breakdowns: options.breakdowns,
    datePreset: options.datePreset,
    since: options.since,
    until: options.until,
    after: options.after,
  });

  const maxPages = parsePositiveInt(options.maxPages, 50);
  const paginated = await fetchAllPages(
    client,
    resolvedPath.path,
    params,
    maxPages,
    options.allPages !== false,
  );

  const minImpressions = parseNonNegativeNumber(options.minImpressions, 0);
  const filteredRows = paginated.data.filter((row) => {
    if (typeof row !== "object" || row === null) {
      return false;
    }

    const impressions = parseMetricValue((row as Record<string, unknown>).impressions);
    return impressions >= minImpressions;
  });

  const kpis = computeKpis(filteredRows);
  const sortMetric = parseSortMetric(options.sortBy);
  const sortOrder = parseSortOrder(options.sortOrder);
  const top = parsePositiveInt(options.top, 5);
  const includeSummaryOnly = options.summaryOnly === true || options.totalsOnly === true;

  const sortedRowsWithMetrics = buildSortedRows(filteredRows, sortMetric, sortOrder);
  const sortedRows = sortedRowsWithMetrics.map((entry) => entry.row);

  const rankedTop = sortedRowsWithMetrics.slice(0, top).map((entry) => ({
    [options.highlightIdField]: entry.row[options.highlightIdField],
    [options.highlightNameField]: entry.row[options.highlightNameField],
    spend: entry.row.spend,
    impressions: entry.row.impressions,
    clicks: entry.row.clicks,
    ctr: entry.metrics.ctr,
    cpc: entry.metrics.cpc,
  }));

  const responseData = includeSummaryOnly
    ? {
        row_count: sortedRows.length,
        paging: {
          cursors: {
            before: paginated.paging.before,
            after: paginated.paging.after,
          },
          has_next_page: paginated.paging.hasNextPage,
        },
      }
    : {
        data: sortedRows,
        row_count: sortedRows.length,
        paging: {
          cursors: {
            before: paginated.paging.before,
            after: paginated.paging.after,
          },
          has_next_page: paginated.paging.hasNextPage,
        },
      };

  const responseKpis = buildKpiOutput(kpis, includeSummaryOnly, options.totalsOnly === true);

  const responseHighlights = options.totalsOnly
    ? undefined
    : {
        top: rankedTop,
      };

  writeJson(io, {
    meta: {
      command: options.commandName,
      nodeType: "ad_account",
      path: resolvedPath.path,
      params,
      pagination: paginated.paging,
      report_options: {
        min_impressions: minImpressions,
        sort_by: sortMetric,
        sort_order: sortOrder,
        top,
        summary_only: includeSummaryOnly,
        totals_only: options.totalsOnly ?? false,
      },
    },
    data: responseData,
    kpis: responseKpis,
    highlights: responseHighlights,
  });
}

async function executeRootGet(
  client: MetaApiClient,
  io: CliIo,
  commandName: string,
  nodeType: GraphNodeType,
  id: string,
  fields?: string,
): Promise<void> {
  const resolvedPath = resolveGraphPath({
    nodeType,
    id,
    method: "GET",
  });

  const params: QueryParams = {
    fields: parseCsv(fields) ?? "id",
  };

  const data = await client.get(resolvedPath.path, params);
  writeJson(io, {
    meta: {
      command: commandName,
      nodeType,
      path: resolvedPath.path,
      params,
    },
    data,
  });
}

export function createProgram(
  client: MetaApiClient,
  io: CliIo = defaultIo,
  dependencies: Partial<CliDependencies> = {},
): Command {
  const authWorkflow = dependencies.authWorkflow ?? createAuthWorkflow();
  const program = new Command();
  program
    .name("fbcli")
    .description("Facebook Ads read-only CLI primitives for agent workflows")
    .version("0.1.0");

  const authCommand = program.command("auth").description("Facebook OAuth authentication helpers");

  authCommand
    .command("login")
    .option("--app-id <id>", "Facebook app id (defaults to FB_APP_ID)")
    .option("--app-secret <secret>", "Facebook app secret (defaults to FB_APP_SECRET)")
    .option(
      "--redirect-uri <uri>",
      "OAuth redirect URI (defaults to FB_REDIRECT_URI or localhost callback)",
      process.env.FB_REDIRECT_URI ?? DEFAULT_REDIRECT_URI,
    )
    .option("--scopes <csv>", "Comma-separated OAuth scopes", DEFAULT_AUTH_SCOPES.join(","))
    .option("--api-version <version>", "Graph API version", process.env.FBCLI_API_VERSION ?? "v25.0")
    .option("--timeout-seconds <n>", "Callback timeout in seconds", "180")
    .option("--no-open", "Do not open browser automatically")
    .option("--no-rerequest", "Do not set auth_type=rerequest")
    .description("Run local OAuth login, exchange code, and save token")
    .action(
      async (options: {
        appId?: string;
        appSecret?: string;
        redirectUri: string;
        scopes: string;
        apiVersion: string;
        timeoutSeconds: string;
        open?: boolean;
        rerequest?: boolean;
      }) => {
        io.stderr(
          `Starting Facebook OAuth login on ${options.redirectUri}. Complete sign-in in your browser.\n`,
        );

        const result = await authWorkflow.login({
          appId: options.appId,
          appSecret: options.appSecret,
          redirectUri: options.redirectUri,
          scopes: parseCsvList(options.scopes),
          apiVersion: options.apiVersion,
          timeoutSeconds: parsePositiveInt(options.timeoutSeconds, 180),
          openBrowser: options.open,
          forceRerequest: options.rerequest,
        });

        writeJson(io, {
          meta: {
            command: "auth login",
          },
          data: result,
        });
      },
    );

  authCommand
    .command("status")
    .option("--api-version <version>", "Graph API version", process.env.FBCLI_API_VERSION ?? "v25.0")
    .option("--skip-api-check", "Read local/env token state without calling Graph")
    .description("Show auth/token status and granted permissions")
    .action(async (options: { apiVersion: string; skipApiCheck?: boolean }) => {
      const result = await authWorkflow.status({
        apiVersion: options.apiVersion,
        skipApiCheck: options.skipApiCheck,
      });

      writeJson(io, {
        meta: {
          command: "auth status",
        },
        data: result,
      });
    });

  authCommand
    .command("logout")
    .description("Remove saved local token from fbcli auth store")
    .action(async () => {
      const result = await authWorkflow.logout();
      writeJson(io, {
        meta: {
          command: "auth logout",
        },
        data: result,
      });
    });

  program
    .command("nodes")
    .description("Graph resource discovery")
    .command("list")
    .description("List supported root nodes")
    .action(() => {
      const nodes = listGraphNodes().map((node) => ({
        type: node.type,
        displayName: node.displayName,
        rootPathTemplate: node.rootPathTemplate,
      }));
      writeJson(io, { nodes });
    });

  program
    .command("edges")
    .description("Graph edge discovery")
    .command("list")
    .requiredOption("--node <type>", "Node type")
    .description("List edges for a node type")
    .action((options: { node: string }) => {
      const nodeType = parseGraphNodeType(options.node);
      const edges = listGraphEdges(nodeType).map((edge) => ({
        name: edge.name,
        description: edge.description,
        read: edge.read,
        write: edge.write,
        mvpReadAllowed: edge.mvpReadAllowed,
      }));
      writeJson(io, {
        nodeType,
        edges,
      });
    });

  program
    .command("describe")
    .requiredOption("--id <graph_id>", "Graph ID")
    .option("--fields <csv>", "Comma-separated fields", "id")
    .option("--node-type <type>", "Node type hint for ambiguous IDs")
    .description("Describe a root node")
    .action(async (options: { id: string; fields: string; nodeType?: string }) => {
      const nodeType = resolveNodeTypeOrInfer(options.id, options.nodeType);
      const resolvedPath = resolveGraphPath({
        nodeType,
        id: options.id,
        method: "GET",
      });
      const params: QueryParams = {
        fields: parseCsv(options.fields) ?? "id",
      };
      const data = await client.get(resolvedPath.path, params);
      writeJson(io, {
        meta: {
          command: "describe",
          nodeType,
          path: resolvedPath.path,
          params,
        },
        data,
      });
    });

  program
    .command("account")
    .description("Ad account operations")
    .command("get")
    .requiredOption("--id <id>", "Ad account ID, e.g. act_123")
    .option("--fields <csv>", "Comma-separated fields", "id,name,account_status")
    .action(async (options: { id: string; fields: string }) => {
      await executeRootGet(client, io, "account get", "ad_account", options.id, options.fields);
    });

  program
    .command("campaign")
    .description("Campaign operations")
    .command("get")
    .requiredOption("--id <id>", "Campaign ID")
    .option("--fields <csv>", "Comma-separated fields", "id,name,status,objective")
    .action(async (options: { id: string; fields: string }) => {
      await executeRootGet(client, io, "campaign get", "campaign", options.id, options.fields);
    });

  program
    .command("adset")
    .description("Ad set operations")
    .command("get")
    .requiredOption("--id <id>", "Ad set ID")
    .option("--fields <csv>", "Comma-separated fields", "id,name,status,daily_budget")
    .action(async (options: { id: string; fields: string }) => {
      await executeRootGet(client, io, "adset get", "adset", options.id, options.fields);
    });

  program
    .command("ad")
    .description("Ad operations")
    .command("get")
    .requiredOption("--id <id>", "Ad ID")
    .option("--fields <csv>", "Comma-separated fields", "id,name,status,effective_status")
    .action(async (options: { id: string; fields: string }) => {
      await executeRootGet(client, io, "ad get", "ad", options.id, options.fields);
    });

  program
    .command("creative")
    .description("Ad creative operations")
    .command("get")
    .requiredOption("--id <id>", "Ad creative ID")
    .option("--fields <csv>", "Comma-separated fields", "id,name,object_story_id")
    .action(async (options: { id: string; fields: string }) => {
      await executeRootGet(client, io, "creative get", "creative", options.id, options.fields);
    });

  program
    .command("user")
    .description("User operations")
    .command("adaccounts")
    .requiredOption("--id <id>", "Ad account user ID")
    .option("--fields <csv>", "Comma-separated fields", "id,name")
    .action(async (options: { id: string; fields: string }) => {
      const resolvedPath = resolveGraphPath({
        nodeType: "user",
        id: options.id,
        edge: "adaccounts",
        method: "GET",
      });
      const params: QueryParams = {
        fields: parseCsv(options.fields) ?? "id",
      };
      const data = await client.get(resolvedPath.path, params);
      writeJson(io, {
        meta: {
          command: "user adaccounts",
          nodeType: "user",
          path: resolvedPath.path,
          params,
        },
        data,
      });
    });

  program
    .command("insights")
    .description("Insights queries")
    .command("query")
    .requiredOption("--node <id>", "Node ID (act_<id>, campaign, adset, ad)")
    .option("--node-type <type>", "Node type hint for ambiguous IDs")
    .option("--fields <csv>", "Comma-separated fields", DEFAULT_INSIGHTS_FIELDS.join(","))
    .option("--breakdowns <csv>", "Comma-separated breakdowns")
    .option("--action-breakdowns <csv>", "Comma-separated action breakdowns")
    .option("--level <level>", "Insights level")
    .option("--date-preset <preset>", "Date preset")
    .option("--since <yyyy-mm-dd>", "Start date")
    .option("--until <yyyy-mm-dd>", "End date")
    .option("--sort <sort>", "Sort, e.g. reach_descending")
    .option("--filtering <json>", "Filtering JSON expression")
    .option("--after <cursor>", "Graph pagination cursor")
    .option("--max-pages <n>", "Maximum pages to fetch", "50")
    .option("--no-all-pages", "Disable automatic pagination")
    .description("Query insights from supported graph nodes")
    .action(
      async (options: {
        node: string;
        nodeType?: string;
        fields: string;
        breakdowns?: string;
        actionBreakdowns?: string;
        level?: string;
        datePreset?: string;
        since?: string;
        until?: string;
        sort?: string;
        filtering?: string;
        after?: string;
        maxPages?: string;
        allPages?: boolean;
      }) => {
        const nodeType = resolveNodeTypeOrInfer(options.node, options.nodeType);
        const resolvedPath = resolveGraphPath({
          nodeType,
          id: options.node,
          edge: "insights",
          method: "GET",
        });

        const params = buildInsightsParams({
          fields: options.fields,
          breakdowns: options.breakdowns,
          actionBreakdowns: options.actionBreakdowns,
          level: options.level,
          datePreset: options.datePreset,
          since: options.since,
          until: options.until,
          sort: options.sort,
          filtering: options.filtering,
          after: options.after,
        });

        const maxPages = parsePositiveInt(options.maxPages, 50);
        const paginated = await fetchAllPages(
          client,
          resolvedPath.path,
          params,
          maxPages,
          options.allPages !== false,
        );
        const kpis = computeKpis(paginated.data);

        writeJson(io, {
          meta: {
            command: "insights query",
            nodeType,
            path: resolvedPath.path,
            params,
            pagination: paginated.paging,
          },
          data: {
            data: paginated.data,
            paging: {
              cursors: {
                before: paginated.paging.before,
                after: paginated.paging.after,
              },
              has_next_page: paginated.paging.hasNextPage,
            },
          },
          kpis,
        });
      },
    );

  const reportCommand = program.command("report").description("Opinionated reporting commands");

  reportCommand
    .command("campaign-deep-dive")
    .requiredOption("--account <id>", "Ad account ID, e.g. act_123")
    .option("--fields <csv>", "Comma-separated fields", DEFAULT_CAMPAIGN_DEEP_DIVE_FIELDS.join(","))
    .option("--breakdowns <csv>", "Comma-separated breakdowns")
    .option("--date-preset <preset>", "Date preset", "last_30d")
    .option("--since <yyyy-mm-dd>", "Start date")
    .option("--until <yyyy-mm-dd>", "End date")
    .option("--after <cursor>", "Graph pagination cursor")
    .option("--max-pages <n>", "Maximum pages to fetch", "50")
    .option("--no-all-pages", "Disable automatic pagination")
    .option("--top <n>", "Number of top rows to include in highlights", "5")
    .option("--min-impressions <n>", "Filter out rows below this impressions threshold", "0")
    .option("--sort-by <metric>", "Sort metric for rows/highlights: spend|ctr|cpc", "spend")
    .option("--sort-order <order>", "Sort order for rows/highlights: desc|asc", "desc")
    .option("--summary-only", "Hide row-level data and return only summary + highlights")
    .option("--totals-only, --total-only", "Return only KPI totals (no row-level data or highlights)")
    .description("Campaign level deep dive report with computed KPIs")
    .action(
      async (options: {
        account: string;
        fields: string;
        breakdowns?: string;
        datePreset?: string;
        since?: string;
        until?: string;
        after?: string;
        maxPages?: string;
        allPages?: boolean;
        top?: string;
        minImpressions?: string;
        sortBy?: string;
        sortOrder?: string;
        summaryOnly?: boolean;
        totalsOnly?: boolean;
        totalOnly?: boolean;
      }) => {
        await runDeepDiveReport(client, io, {
          commandName: "report campaign-deep-dive",
          account: options.account,
          fields: options.fields,
          level: "campaign",
          breakdowns: options.breakdowns,
          datePreset: options.datePreset,
          since: options.since,
          until: options.until,
          after: options.after,
          maxPages: options.maxPages,
          allPages: options.allPages,
          highlightIdField: "campaign_id",
          highlightNameField: "campaign_name",
          top: options.top,
          minImpressions: options.minImpressions,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          summaryOnly: options.summaryOnly,
          totalsOnly: options.totalsOnly ?? options.totalOnly,
        });
      },
    );

  reportCommand
    .command("adset-deep-dive")
    .requiredOption("--account <id>", "Ad account ID, e.g. act_123")
    .option("--fields <csv>", "Comma-separated fields", DEFAULT_ADSET_DEEP_DIVE_FIELDS.join(","))
    .option("--breakdowns <csv>", "Comma-separated breakdowns")
    .option("--date-preset <preset>", "Date preset", "last_30d")
    .option("--since <yyyy-mm-dd>", "Start date")
    .option("--until <yyyy-mm-dd>", "End date")
    .option("--after <cursor>", "Graph pagination cursor")
    .option("--max-pages <n>", "Maximum pages to fetch", "50")
    .option("--no-all-pages", "Disable automatic pagination")
    .option("--top <n>", "Number of top rows to include in highlights", "5")
    .option("--min-impressions <n>", "Filter out rows below this impressions threshold", "0")
    .option("--sort-by <metric>", "Sort metric for rows/highlights: spend|ctr|cpc", "spend")
    .option("--sort-order <order>", "Sort order for rows/highlights: desc|asc", "desc")
    .option("--summary-only", "Hide row-level data and return only summary + highlights")
    .option("--totals-only, --total-only", "Return only KPI totals (no row-level data or highlights)")
    .description("Ad set level deep dive report with computed KPIs")
    .action(
      async (options: {
        account: string;
        fields: string;
        breakdowns?: string;
        datePreset?: string;
        since?: string;
        until?: string;
        after?: string;
        maxPages?: string;
        allPages?: boolean;
        top?: string;
        minImpressions?: string;
        sortBy?: string;
        sortOrder?: string;
        summaryOnly?: boolean;
        totalsOnly?: boolean;
        totalOnly?: boolean;
      }) => {
        await runDeepDiveReport(client, io, {
          commandName: "report adset-deep-dive",
          account: options.account,
          fields: options.fields,
          level: "adset",
          breakdowns: options.breakdowns,
          datePreset: options.datePreset,
          since: options.since,
          until: options.until,
          after: options.after,
          maxPages: options.maxPages,
          allPages: options.allPages,
          highlightIdField: "adset_id",
          highlightNameField: "adset_name",
          top: options.top,
          minImpressions: options.minImpressions,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          summaryOnly: options.summaryOnly,
          totalsOnly: options.totalsOnly ?? options.totalOnly,
        });
      },
    );

  reportCommand
    .command("creative-deep-dive")
    .requiredOption("--account <id>", "Ad account ID, e.g. act_123")
    .option("--fields <csv>", "Comma-separated fields", DEFAULT_CREATIVE_DEEP_DIVE_FIELDS.join(","))
    .option("--breakdowns <csv>", "Comma-separated breakdowns")
    .option("--date-preset <preset>", "Date preset", "last_30d")
    .option("--since <yyyy-mm-dd>", "Start date")
    .option("--until <yyyy-mm-dd>", "End date")
    .option("--after <cursor>", "Graph pagination cursor")
    .option("--max-pages <n>", "Maximum pages to fetch", "50")
    .option("--no-all-pages", "Disable automatic pagination")
    .option("--top <n>", "Number of top rows to include in highlights", "5")
    .option("--min-impressions <n>", "Filter out rows below this impressions threshold", "0")
    .option("--sort-by <metric>", "Sort metric for rows/highlights: spend|ctr|cpc", "spend")
    .option("--sort-order <order>", "Sort order for rows/highlights: desc|asc", "desc")
    .option("--summary-only", "Hide row-level data and return only summary + highlights")
    .option("--totals-only, --total-only", "Return only KPI totals (no row-level data or highlights)")
    .description("Creative-level (ad-level) deep dive report with computed KPIs")
    .action(
      async (options: {
        account: string;
        fields: string;
        breakdowns?: string;
        datePreset?: string;
        since?: string;
        until?: string;
        after?: string;
        maxPages?: string;
        allPages?: boolean;
        top?: string;
        minImpressions?: string;
        sortBy?: string;
        sortOrder?: string;
        summaryOnly?: boolean;
        totalsOnly?: boolean;
        totalOnly?: boolean;
      }) => {
        await runDeepDiveReport(client, io, {
          commandName: "report creative-deep-dive",
          account: options.account,
          fields: options.fields,
          level: "ad",
          breakdowns: options.breakdowns,
          datePreset: options.datePreset,
          since: options.since,
          until: options.until,
          after: options.after,
          maxPages: options.maxPages,
          allPages: options.allPages,
          highlightIdField: "ad_id",
          highlightNameField: "ad_name",
          top: options.top,
          minImpressions: options.minImpressions,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          summaryOnly: options.summaryOnly,
          totalsOnly: options.totalsOnly ?? options.totalOnly,
        });
      },
    );

  return program;
}

export async function runCli(
  argv: string[],
  client: MetaApiClient,
  io: CliIo = defaultIo,
  dependencies: Partial<CliDependencies> = {},
): Promise<RunCliResult> {
  try {
    const helpSelection = parseHelpJsonSelection(argv);
    if (helpSelection) {
      const payload = buildManifestSelectionPayload(helpSelection);
      writeJson(io, payload);
      return { exitCode: 0 };
    }
  } catch (error) {
    const structuredError = toStructuredError(error);
    io.stderr(`${JSON.stringify({ errors: [structuredError] }, null, 2)}\n`);
    return {
      exitCode: 1,
      error: structuredError,
    };
  }

  const program = createProgram(client, io, dependencies);
  program.exitOverride();

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode: 0 };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "exitCode" in error &&
      typeof (error as { exitCode?: unknown }).exitCode === "number" &&
      (error as { exitCode: number }).exitCode === 0
    ) {
      return { exitCode: 0 };
    }

    const structuredError = toStructuredError(error);
    io.stderr(`${JSON.stringify({ errors: [structuredError] }, null, 2)}\n`);
    return {
      exitCode: 1,
      error: structuredError,
    };
  }
}

function parseHelpJsonSelection(argv: string[]): HelpJsonSelection | null {
  if (argv[0] !== "help" || !argv.includes("--json")) {
    return null;
  }

  const selection: HelpJsonSelection = {};

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      continue;
    }

    if (token === "--errors-only") {
      selection.errorsOnly = true;
      continue;
    }

    if (token === "--command-id" || token.startsWith("--command-id=")) {
      const value = readOptionValue(argv, index, "--command-id");
      selection.commandId = value.value;
      index = value.nextIndex;
      continue;
    }

    if (token === "--recipe-id" || token.startsWith("--recipe-id=")) {
      const value = readOptionValue(argv, index, "--recipe-id");
      selection.recipeId = value.value;
      index = value.nextIndex;
      continue;
    }

    throw new Error(`Unsupported help --json option: ${token}`);
  }

  return selection;
}

function readOptionValue(
  argv: string[],
  index: number,
  optionName: "--command-id" | "--recipe-id",
): { value: string; nextIndex: number } {
  const token = argv[index];
  if (token.startsWith(`${optionName}=`)) {
    const value = token.slice(optionName.length + 1).trim();
    if (!value) {
      throw new Error(`Missing value for ${optionName}`);
    }

    return { value, nextIndex: index };
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return {
    value: next,
    nextIndex: index + 1,
  };
}
