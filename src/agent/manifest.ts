import { type FbCliErrorCode } from "../errors/fbcli-error.js";

export const FBCLI_MANIFEST_VERSION = "1.0.0";
export const FBCLI_VERSION = "0.1.0";

export type CommandOptionType = "string" | "number" | "boolean" | "csv" | "json" | "date";

export type CommandOptionDescriptor = {
  name: string;
  aliases: string[];
  type: CommandOptionType;
  required: boolean;
  value_hint?: string;
  default?: string | number | boolean;
  enum?: string[];
  description: string;
};

export type CommandArgumentDescriptor = {
  name: string;
  required: boolean;
  description: string;
};

export type CommandExample = {
  title: string;
  command: string;
};

export type CommandOutputContract = {
  top_level_keys: string[];
  key_notes: Record<string, string>;
  conditional_notes: string[];
};

export type CommandDescriptor = {
  id: string;
  path: string[];
  summary: string;
  options: CommandOptionDescriptor[];
  arguments: CommandArgumentDescriptor[];
  output_contract: CommandOutputContract;
  examples: CommandExample[];
};

export type ErrorDescriptor = {
  code: FbCliErrorCode;
  description: string;
  likely_cause: string;
  suggested_fix: string;
};

export type ManifestRecipe = {
  id: string;
  title: string;
  description: string;
  references: string[];
  placeholders: Array<{ name: string; description: string }>;
  steps: Array<{
    title: string;
    command: string;
    output: string;
  }>;
};

export type FbCliManifestV1 = {
  manifest_version: string;
  cli: {
    name: "fbcli";
    version: string;
  };
  stability: {
    contract: "stable";
    compatibility_policy: string[];
  };
  environment: {
    required: Array<{ name: string; description: string }>;
    optional: Array<{ name: string; description: string; default?: string }>;
  };
  errors: ErrorDescriptor[];
  commands: CommandDescriptor[];
  recipes: ManifestRecipe[];
};

function makeOption(option: CommandOptionDescriptor): CommandOptionDescriptor {
  return {
    ...option,
    aliases: [...option.aliases],
    enum: option.enum ? [...option.enum] : undefined,
  };
}

function cloneManifest(manifest: FbCliManifestV1): FbCliManifestV1 {
  return JSON.parse(JSON.stringify(manifest)) as FbCliManifestV1;
}

const ERROR_CATALOG: ErrorDescriptor[] = [
  {
    code: "INVALID_NODE_TYPE",
    description: "A provided node type is not supported by fbcli.",
    likely_cause: "Typo in --node-type or unsupported resource type.",
    suggested_fix: "Run fbcli nodes list or help --json and use a supported node type.",
  },
  {
    code: "INVALID_GRAPH_ID",
    description: "A Graph ID failed fbcli normalization or format checks.",
    likely_cause: "Malformed ID (extra slashes, wrong prefix, empty value).",
    suggested_fix: "Use a valid Graph ID (for ad accounts, prefix with act_).",
  },
  {
    code: "AMBIGUOUS_GRAPH_ID",
    description: "A numeric Graph ID could map to multiple node types.",
    likely_cause: "Using raw numeric IDs without --node-type hint.",
    suggested_fix: "Pass --node-type explicitly when using numeric IDs.",
  },
  {
    code: "EDGE_NOT_SUPPORTED",
    description: "Requested edge is not supported for the resolved node type.",
    likely_cause: "Incompatible node + edge combination.",
    suggested_fix: "Run fbcli edges list --node <type> and pick a supported edge.",
  },
  {
    code: "UNSUPPORTED_IN_MVP",
    description: "Operation exists in Graph API but is blocked by read-only MVP guardrails.",
    likely_cause: "Write operation or non-MVP edge usage.",
    suggested_fix: "Use GET-only commands within MVP-supported edges.",
  },
  {
    code: "MISSING_TOKEN",
    description: "No access token was provided for Meta API calls.",
    likely_cause: "FBCLI_ACCESS_TOKEN env var not set.",
    suggested_fix: "Export FBCLI_ACCESS_TOKEN before running API commands.",
  },
  {
    code: "MISSING_APP_CREDENTIALS",
    description: "OAuth login command did not receive required app credentials.",
    likely_cause: "FB_APP_ID/FB_APP_SECRET are missing and no --app-id/--app-secret flags were passed.",
    suggested_fix: "Set FB_APP_ID and FB_APP_SECRET, or pass both flags to fbcli auth login.",
  },
  {
    code: "AUTH_CALLBACK_LISTENER_ERROR",
    description: "Local OAuth callback listener could not start or process callback data.",
    likely_cause: "Invalid redirect URI, occupied callback port, denied OAuth grant, or callback host mismatch.",
    suggested_fix: "Use localhost redirect URI, free the callback port, then retry auth login.",
  },
  {
    code: "AUTH_CALLBACK_TIMEOUT",
    description: "OAuth callback was not received before timeout.",
    likely_cause: "Browser sign-in was not completed or redirect URI did not return to local callback.",
    suggested_fix: "Complete Facebook sign-in promptly or increase --timeout-seconds.",
  },
  {
    code: "AUTH_STATE_MISMATCH",
    description: "OAuth state in callback did not match the generated state.",
    likely_cause: "Interrupted flow or unexpected callback URL tampering.",
    suggested_fix: "Retry login from a fresh auth command and avoid reusing stale callback URLs.",
  },
  {
    code: "AUTH_TOKEN_EXCHANGE_FAILED",
    description: "Authorization code exchange failed at Meta OAuth endpoint.",
    likely_cause: "Expired code, invalid app secret, wrong redirect_uri, or API-side OAuth error.",
    suggested_fix: "Verify FB_APP_ID/FB_APP_SECRET/redirect URI alignment and run login again.",
  },
  {
    code: "AUTH_STORAGE_ERROR",
    description: "fbcli could not read or write local auth token storage.",
    likely_cause: "Filesystem permission issues or corrupted token file.",
    suggested_fix: "Fix file permissions and retry auth login/logout.",
  },
  {
    code: "META_API_ERROR",
    description: "Meta Graph API returned an error or upstream failure occurred.",
    likely_cause: "Permission issues, invalid params, expired token, or API-side failure.",
    suggested_fix: "Inspect error.details and validate token scopes, IDs, and parameters.",
  },
];

const COMMANDS: CommandDescriptor[] = [
  {
    id: "help.json",
    path: ["help", "--json"],
    summary: "Machine-readable discovery manifest for AI agents.",
    options: [
      makeOption({
        name: "--json",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Return the machine-readable manifest instead of human help text.",
      }),
      makeOption({
        name: "--command-id",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<id>",
        description: "Return one command descriptor by stable command id.",
      }),
      makeOption({
        name: "--recipe-id",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<id>",
        description: "Return one recipe descriptor by stable recipe id.",
      }),
      makeOption({
        name: "--errors-only",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Return only the error catalog section.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["manifest_version", "cli", "stability", "environment", "errors", "commands", "recipes"],
      key_notes: {
        manifest_version: "Versioned discovery contract. Major changes indicate breaking schema changes.",
        commands: "Stable command descriptors for agent planning/execution.",
        recipes: "Generic runnable templates with placeholders.",
      },
      conditional_notes: [
        "With --command-id, output is { manifest_version, command }.",
        "With --recipe-id, output is { manifest_version, recipe }.",
        "With --errors-only, output is { manifest_version, errors }.",
      ],
    },
    examples: [
      { title: "Full manifest", command: "fbcli help --json" },
      { title: "Single command", command: "fbcli help --json --command-id report.creative-deep-dive" },
      { title: "Error catalog", command: "fbcli help --json --errors-only" },
    ],
  },
  {
    id: "auth.login",
    path: ["auth", "login"],
    summary: "Run localhost OAuth login and persist access token for fbcli.",
    options: [
      makeOption({
        name: "--app-id",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<id>",
        description: "Facebook app id (falls back to FB_APP_ID).",
      }),
      makeOption({
        name: "--app-secret",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<secret>",
        description: "Facebook app secret (falls back to FB_APP_SECRET).",
      }),
      makeOption({
        name: "--redirect-uri",
        aliases: [],
        type: "string",
        required: false,
        default: "http://localhost:53682/auth/facebook/callback",
        value_hint: "<uri>",
        description: "OAuth callback URI for local listener.",
      }),
      makeOption({
        name: "--scopes",
        aliases: [],
        type: "csv",
        required: false,
        default:
          "ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,pages_manage_ads,public_profile",
        value_hint: "<csv>",
        description: "Comma-separated scope list to request.",
      }),
      makeOption({
        name: "--api-version",
        aliases: [],
        type: "string",
        required: false,
        default: "v25.0",
        value_hint: "<version>",
        description: "Graph API version for OAuth/token exchange.",
      }),
      makeOption({
        name: "--timeout-seconds",
        aliases: [],
        type: "number",
        required: false,
        default: 180,
        value_hint: "<n>",
        description: "Maximum wait time for OAuth callback.",
      }),
      makeOption({
        name: "--no-open",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Disable auto-opening browser and print URL only.",
      }),
      makeOption({
        name: "--no-rerequest",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Do not set auth_type=rerequest in OAuth URL.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Includes token metadata and granted/declined permissions. Access token is saved locally.",
      },
      conditional_notes: [],
    },
    examples: [
      { title: "Standard login", command: "fbcli auth login" },
      {
        title: "Custom redirect URI",
        command: "fbcli auth login --redirect-uri http://localhost:53682/auth/facebook/callback",
      },
    ],
  },
  {
    id: "auth.status",
    path: ["auth", "status"],
    summary: "Show token status from env/store and optionally validate with Graph API.",
    options: [
      makeOption({
        name: "--api-version",
        aliases: [],
        type: "string",
        required: false,
        default: "v25.0",
        value_hint: "<version>",
        description: "Graph API version for validation checks.",
      }),
      makeOption({
        name: "--skip-api-check",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Skip /me and /me/permissions calls.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Includes source (env/store), auth state, and permissions when API check is enabled.",
      },
      conditional_notes: ["When no token is available, data.authenticated is false and source is none."],
    },
    examples: [
      { title: "Check status", command: "fbcli auth status" },
      { title: "Local-only check", command: "fbcli auth status --skip-api-check" },
    ],
  },
  {
    id: "auth.logout",
    path: ["auth", "logout"],
    summary: "Remove locally saved OAuth token from fbcli auth storage.",
    options: [],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Returns whether a stored token file was removed.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Logout", command: "fbcli auth logout" }],
  },
  {
    id: "nodes.list",
    path: ["nodes", "list"],
    summary: "List supported root graph node types.",
    options: [],
    arguments: [],
    output_contract: {
      top_level_keys: ["nodes"],
      key_notes: {
        nodes: "Array of supported root node descriptors.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "List nodes", command: "fbcli nodes list" }],
  },
  {
    id: "edges.list",
    path: ["edges", "list"],
    summary: "List supported edges for a node type.",
    options: [
      makeOption({
        name: "--node",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<type>",
        description: "Node type to inspect edges for.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["nodeType", "edges"],
      key_notes: {
        edges: "Array of edge capabilities including read/write flags and MVP availability.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Edges for ad account", command: "fbcli edges list --node ad_account" }],
  },
  {
    id: "describe",
    path: ["describe"],
    summary: "Describe any root node by ID.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<graph_id>",
        description: "Graph ID for the node.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
      makeOption({
        name: "--node-type",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<type>",
        description: "Node type hint for ambiguous IDs.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        meta: "Execution metadata including resolved node type and path.",
      },
      conditional_notes: [],
    },
    examples: [
      {
        title: "Describe ad account",
        command: "fbcli describe --id act_{{account_id}} --fields id,name,account_status",
      },
    ],
  },
  {
    id: "account.get",
    path: ["account", "get"],
    summary: "Fetch ad account root node fields.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Ad account ID (act_<id>).",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name,account_status",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Get account", command: "fbcli account get --id act_{{account_id}}" }],
  },
  {
    id: "campaign.get",
    path: ["campaign", "get"],
    summary: "Fetch campaign root node fields.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Campaign ID.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name,status,objective",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Get campaign", command: "fbcli campaign get --id {{campaign_id}}" }],
  },
  {
    id: "adset.get",
    path: ["adset", "get"],
    summary: "Fetch ad set root node fields.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Ad set ID.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name,status,daily_budget",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Get ad set", command: "fbcli adset get --id {{adset_id}}" }],
  },
  {
    id: "ad.get",
    path: ["ad", "get"],
    summary: "Fetch ad root node fields.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Ad ID.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name,status,effective_status",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Get ad", command: "fbcli ad get --id {{ad_id}}" }],
  },
  {
    id: "creative.get",
    path: ["creative", "get"],
    summary: "Fetch ad creative root node fields.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Ad creative ID.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name,object_story_id",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "Get creative", command: "fbcli creative get --id {{creative_id}}" }],
  },
  {
    id: "user.adaccounts",
    path: ["user", "adaccounts"],
    summary: "List ad accounts associated with a user.",
    options: [
      makeOption({
        name: "--id",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Ad account user ID.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        default: "id,name",
        value_hint: "<csv>",
        description: "Comma-separated fields to fetch.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data"],
      key_notes: {
        data: "Raw Graph API response payload.",
      },
      conditional_notes: [],
    },
    examples: [{ title: "List user ad accounts", command: "fbcli user adaccounts --id {{user_id}}" }],
  },
  {
    id: "insights.query",
    path: ["insights", "query"],
    summary: "General-purpose insights query with auto-pagination and KPI rollups.",
    options: [
      makeOption({
        name: "--node",
        aliases: [],
        type: "string",
        required: true,
        value_hint: "<id>",
        description: "Node ID (act_<id>, campaign, adset, ad).",
      }),
      makeOption({
        name: "--node-type",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<type>",
        description: "Node type hint for ambiguous IDs.",
      }),
      makeOption({
        name: "--fields",
        aliases: [],
        type: "csv",
        required: false,
        value_hint: "<csv>",
        default: "impressions,clicks,spend",
        description: "Comma-separated fields.",
      }),
      makeOption({
        name: "--breakdowns",
        aliases: [],
        type: "csv",
        required: false,
        value_hint: "<csv>",
        description: "Breakdowns list.",
      }),
      makeOption({
        name: "--action-breakdowns",
        aliases: [],
        type: "csv",
        required: false,
        value_hint: "<csv>",
        description: "Action breakdowns list.",
      }),
      makeOption({
        name: "--level",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<level>",
        description: "Insights aggregation level.",
      }),
      makeOption({
        name: "--date-preset",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<preset>",
        description: "Meta date preset.",
      }),
      makeOption({
        name: "--since",
        aliases: [],
        type: "date",
        required: false,
        value_hint: "<yyyy-mm-dd>",
        description: "Start date (requires --until for explicit range).",
      }),
      makeOption({
        name: "--until",
        aliases: [],
        type: "date",
        required: false,
        value_hint: "<yyyy-mm-dd>",
        description: "End date (requires --since for explicit range).",
      }),
      makeOption({
        name: "--sort",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<sort>",
        description: "Sort expression (e.g. reach_descending).",
      }),
      makeOption({
        name: "--filtering",
        aliases: [],
        type: "json",
        required: false,
        value_hint: "<json>",
        description: "JSON filtering expression.",
      }),
      makeOption({
        name: "--after",
        aliases: [],
        type: "string",
        required: false,
        value_hint: "<cursor>",
        description: "Graph pagination cursor.",
      }),
      makeOption({
        name: "--max-pages",
        aliases: [],
        type: "number",
        required: false,
        value_hint: "<n>",
        default: 50,
        description: "Maximum pages to fetch.",
      }),
      makeOption({
        name: "--no-all-pages",
        aliases: [],
        type: "boolean",
        required: false,
        default: false,
        description: "Disable auto-pagination beyond the first page.",
      }),
    ],
    arguments: [],
    output_contract: {
      top_level_keys: ["meta", "data", "kpis"],
      key_notes: {
        data: "Contains raw rows under data.data and paging cursors.",
        kpis: "Computed CTR/CPC/CPM at row and totals levels.",
      },
      conditional_notes: [
        "If --no-all-pages is set, only first page rows are included.",
        "time_range is present only when both --since and --until are supplied.",
      ],
    },
    examples: [
      {
        title: "Account insights for last 7d",
        command:
          "fbcli insights query --node act_{{account_id}} --fields impressions,clicks,spend,actions --date-preset last_7d",
      },
    ],
  },
  {
    id: "report.campaign-deep-dive",
    path: ["report", "campaign-deep-dive"],
    summary: "Opinionated campaign-level deep-dive report.",
    options: buildReportOptions(),
    arguments: [],
    output_contract: buildDeepDiveOutputContract(),
    examples: [
      {
        title: "Top campaign creatives by spend",
        command:
          "fbcli report campaign-deep-dive --account act_{{account_id}} --date-preset last_30d --top 10 --sort-by spend --sort-order desc",
      },
    ],
  },
  {
    id: "report.adset-deep-dive",
    path: ["report", "adset-deep-dive"],
    summary: "Opinionated adset-level deep-dive report.",
    options: buildReportOptions(),
    arguments: [],
    output_contract: buildDeepDiveOutputContract(),
    examples: [
      {
        title: "Adset report summary only",
        command:
          "fbcli report adset-deep-dive --account act_{{account_id}} --date-preset last_30d --summary-only --top 5",
      },
    ],
  },
  {
    id: "report.creative-deep-dive",
    path: ["report", "creative-deep-dive"],
    summary: "Opinionated ad-level (creative) deep-dive report.",
    options: buildReportOptions(),
    arguments: [],
    output_contract: buildDeepDiveOutputContract(),
    examples: [
      {
        title: "Totals-only KPI snapshot",
        command:
          "fbcli report creative-deep-dive --account act_{{account_id}} --date-preset last_30d --totals-only",
      },
    ],
  },
];

function buildReportOptions(): CommandOptionDescriptor[] {
  return [
    makeOption({
      name: "--account",
      aliases: [],
      type: "string",
      required: true,
      value_hint: "<id>",
      description: "Ad account ID (act_<id>).",
    }),
    makeOption({
      name: "--fields",
      aliases: [],
      type: "csv",
      required: false,
      value_hint: "<csv>",
      description: "Comma-separated fields for insights rows.",
    }),
    makeOption({
      name: "--breakdowns",
      aliases: [],
      type: "csv",
      required: false,
      value_hint: "<csv>",
      description: "Comma-separated breakdown fields.",
    }),
    makeOption({
      name: "--date-preset",
      aliases: [],
      type: "string",
      required: false,
      value_hint: "<preset>",
      default: "last_30d",
      description: "Meta date preset.",
    }),
    makeOption({
      name: "--since",
      aliases: [],
      type: "date",
      required: false,
      value_hint: "<yyyy-mm-dd>",
      description: "Start date (requires --until for explicit range).",
    }),
    makeOption({
      name: "--until",
      aliases: [],
      type: "date",
      required: false,
      value_hint: "<yyyy-mm-dd>",
      description: "End date (requires --since for explicit range).",
    }),
    makeOption({
      name: "--after",
      aliases: [],
      type: "string",
      required: false,
      value_hint: "<cursor>",
      description: "Graph pagination cursor.",
    }),
    makeOption({
      name: "--max-pages",
      aliases: [],
      type: "number",
      required: false,
      value_hint: "<n>",
      default: 50,
      description: "Maximum pages to fetch.",
    }),
    makeOption({
      name: "--no-all-pages",
      aliases: [],
      type: "boolean",
      required: false,
      default: false,
      description: "Disable auto-pagination beyond first page.",
    }),
    makeOption({
      name: "--top",
      aliases: [],
      type: "number",
      required: false,
      value_hint: "<n>",
      default: 5,
      description: "Number of highlights to include.",
    }),
    makeOption({
      name: "--min-impressions",
      aliases: [],
      type: "number",
      required: false,
      value_hint: "<n>",
      default: 0,
      description: "Exclude rows below this impressions threshold.",
    }),
    makeOption({
      name: "--sort-by",
      aliases: [],
      type: "string",
      required: false,
      value_hint: "<metric>",
      default: "spend",
      enum: ["spend", "ctr", "cpc"],
      description: "Sort metric for rows/highlights.",
    }),
    makeOption({
      name: "--sort-order",
      aliases: [],
      type: "string",
      required: false,
      value_hint: "<order>",
      default: "desc",
      enum: ["desc", "asc"],
      description: "Sort order for rows/highlights.",
    }),
    makeOption({
      name: "--summary-only",
      aliases: [],
      type: "boolean",
      required: false,
      default: false,
      description: "Suppress row-level data rows and kpis.rows.",
    }),
    makeOption({
      name: "--totals-only",
      aliases: ["--total-only"],
      type: "boolean",
      required: false,
      default: false,
      description: "Return only KPI totals (no highlights, no kpi rows).",
    }),
  ];
}

function buildDeepDiveOutputContract(): CommandOutputContract {
  return {
    top_level_keys: ["meta", "data", "kpis", "highlights"],
    key_notes: {
      data: "Contains sorted row data unless summary/totals modes are enabled.",
      kpis: "Contains row + totals KPIs by default, totals only in compact modes.",
      highlights: "Top-ranked entities according to selected metric/order.",
    },
    conditional_notes: [
      "With --summary-only, data.data is removed and kpis.rows is removed.",
      "With --totals-only (or --total-only), highlights is removed and kpis includes totals only.",
    ],
  };
}

const RECIPES: ManifestRecipe[] = [
  {
    id: "entity.describe",
    title: "Describe any graph entity",
    description: "Resolve an entity quickly with minimal fields before deeper queries.",
    references: ["describe"],
    placeholders: [
      { name: "graph_id", description: "Graph ID for the target entity." },
      { name: "node_type", description: "Optional node type hint for numeric IDs." },
    ],
    steps: [
      {
        title: "Describe entity",
        command: "fbcli describe --id {{graph_id}} --node-type {{node_type}} --fields id,name",
        output: "JSON with meta + data payload.",
      },
    ],
  },
  {
    id: "insights.time_range_query",
    title: "Insights query by explicit date range",
    description: "Fetch one bounded period with optional actions and KPI rollups.",
    references: ["insights.query"],
    placeholders: [
      { name: "account_id", description: "Ad account numeric id without act_ prefix." },
      { name: "since", description: "Start date yyyy-mm-dd." },
      { name: "until", description: "End date yyyy-mm-dd." },
    ],
    steps: [
      {
        title: "Run query",
        command:
          "fbcli insights query --node act_{{account_id}} --level account --fields spend,actions,clicks,impressions --since {{since}} --until {{until}}",
        output: "JSON with meta, data.data rows, and computed kpis.",
      },
    ],
  },
  {
    id: "insights.period_compare",
    title: "Compare two periods",
    description: "Run two consistent insights queries and compare downstream.",
    references: ["insights.query"],
    placeholders: [
      { name: "account_id", description: "Ad account numeric id without act_ prefix." },
      { name: "since_a", description: "Period A start date yyyy-mm-dd." },
      { name: "until_a", description: "Period A end date yyyy-mm-dd." },
      { name: "since_b", description: "Period B start date yyyy-mm-dd." },
      { name: "until_b", description: "Period B end date yyyy-mm-dd." },
    ],
    steps: [
      {
        title: "Period A",
        command:
          "fbcli insights query --node act_{{account_id}} --level account --fields spend,actions,clicks,impressions --since {{since_a}} --until {{until_a}} > period_a.json",
        output: "period_a.json",
      },
      {
        title: "Period B",
        command:
          "fbcli insights query --node act_{{account_id}} --level account --fields spend,actions,clicks,impressions --since {{since_b}} --until {{until_b}} > period_b.json",
        output: "period_b.json",
      },
      {
        title: "Inspect KPI totals",
        command: "jq '{a:.kpis.totals}' period_a.json && jq '{b:.kpis.totals}' period_b.json",
        output: "Terminal JSON summaries for quick delta computation.",
      },
    ],
  },
  {
    id: "report.deep_dive_ranked",
    title: "Ranked deep-dive report",
    description: "Generate ranked highlights from deep-dive report commands.",
    references: ["report.campaign-deep-dive", "report.adset-deep-dive", "report.creative-deep-dive"],
    placeholders: [
      { name: "account_id", description: "Ad account numeric id without act_ prefix." },
      { name: "report_name", description: "One of campaign-deep-dive|adset-deep-dive|creative-deep-dive." },
    ],
    steps: [
      {
        title: "Run ranked report",
        command:
          "fbcli report {{report_name}} --account act_{{account_id}} --date-preset last_30d --top 10 --min-impressions 1000 --sort-by ctr --sort-order desc",
        output: "JSON report with ranked highlights and KPI totals.",
      },
    ],
  },
  {
    id: "report.totals_only",
    title: "Compact totals-only reporting",
    description: "Get minimal KPI totals payload for low-token agent workflows.",
    references: ["report.creative-deep-dive"],
    placeholders: [{ name: "account_id", description: "Ad account numeric id without act_ prefix." }],
    steps: [
      {
        title: "Run totals-only report",
        command: "fbcli report creative-deep-dive --account act_{{account_id}} --date-preset last_30d --totals-only",
        output: "JSON with compact data summary and kpis.totals only.",
      },
    ],
  },
];

export function buildManifestV1(): FbCliManifestV1 {
  const manifest: FbCliManifestV1 = {
    manifest_version: FBCLI_MANIFEST_VERSION,
    cli: {
      name: "fbcli",
      version: FBCLI_VERSION,
    },
    stability: {
      contract: "stable",
      compatibility_policy: [
        "Breaking discovery contract changes require manifest_version major bump.",
        "Within same major version, only additive fields are allowed.",
        "Published command ids are stable and must not be renamed without major bump.",
      ],
    },
    environment: {
      required: [],
      optional: [
        {
          name: "FBCLI_ACCESS_TOKEN",
          description: "Meta access token used for Graph API GET requests. Overrides stored auth token.",
        },
        {
          name: "FBCLI_API_VERSION",
          description: "Graph API version prefix used for requests.",
          default: "v25.0",
        },
        {
          name: "FB_APP_ID",
          description: "Facebook app id used by fbcli auth login.",
        },
        {
          name: "FB_APP_SECRET",
          description: "Facebook app secret used by fbcli auth login.",
        },
        {
          name: "FB_REDIRECT_URI",
          description: "OAuth redirect URI used by fbcli auth login.",
          default: "http://localhost:53682/auth/facebook/callback",
        },
        {
          name: "FBCLI_AUTH_FILE",
          description: "Optional override for local stored auth token path.",
        },
      ],
    },
    errors: [...ERROR_CATALOG],
    commands: [...COMMANDS],
    recipes: [...RECIPES],
  };

  return cloneManifest(manifest);
}

export type HelpJsonSelection = {
  commandId?: string;
  recipeId?: string;
  errorsOnly?: boolean;
};

function assertSingleFilter(selection: HelpJsonSelection): void {
  const usedFilters = [selection.commandId, selection.recipeId, selection.errorsOnly ? "errorsOnly" : undefined].filter(
    Boolean,
  );
  if (usedFilters.length <= 1) {
    return;
  }

  throw new Error("Use only one of --command-id, --recipe-id, or --errors-only with help --json.");
}

export function buildManifestSelectionPayload(selection: HelpJsonSelection = {}): unknown {
  assertSingleFilter(selection);
  const manifest = buildManifestV1();

  if (selection.errorsOnly) {
    return {
      manifest_version: manifest.manifest_version,
      errors: manifest.errors,
    };
  }

  if (selection.commandId) {
    const command = manifest.commands.find((item) => item.id === selection.commandId);
    if (!command) {
      throw new Error(`Unknown command id: ${selection.commandId}`);
    }

    return {
      manifest_version: manifest.manifest_version,
      command,
    };
  }

  if (selection.recipeId) {
    const recipe = manifest.recipes.find((item) => item.id === selection.recipeId);
    if (!recipe) {
      throw new Error(`Unknown recipe id: ${selection.recipeId}`);
    }

    return {
      manifest_version: manifest.manifest_version,
      recipe,
    };
  }

  return manifest;
}
