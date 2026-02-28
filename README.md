# fbcli

[![CI](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml)

> Replace `<OWNER>/<REPO>` with your GitHub repository path after pushing.

Read-only Facebook Marketing API CLI primitives for agent workflows.

## Commands

- `fbcli help --json`
- `fbcli auth login`
- `fbcli auth status`
- `fbcli auth logout`
- `fbcli nodes list`
- `fbcli edges list --node <type>`
- `fbcli describe --id <GRAPH_ID> --fields <csv> [--node-type <type>]`
- `fbcli account get --id act_<AD_ACCOUNT_ID>`
- `fbcli campaign get --id <AD_CAMPAIGN_ID>`
- `fbcli adset get --id <AD_SET_ID>`
- `fbcli ad get --id <AD_ID>`
- `fbcli creative get --id <AD_CREATIVE_ID>`
- `fbcli user adaccounts --id <AD_ACCOUNT_USER_ID>`
- `fbcli insights query --node <ID> [--node-type <type>]`
- `fbcli report campaign-deep-dive --account act_<AD_ACCOUNT_ID>`
- `fbcli report adset-deep-dive --account act_<AD_ACCOUNT_ID>`
- `fbcli report creative-deep-dive --account act_<AD_ACCOUNT_ID>`

## Agent Integration

Canonical discovery entrypoint:

```bash
fbcli help --json
```

Focused discovery filters:

```bash
fbcli help --json --command-id report.creative-deep-dive
fbcli help --json --recipe-id insights.period_compare
fbcli help --json --errors-only
```

### Manifest contract

- Manifest version: `manifest_version` (currently `1.0.0`)
- Compatibility policy:
  - breaking contract changes require **major** manifest version bump
  - same major allows additive fields only
  - published command `id` values are stable identifiers

Schema artifacts for agent/tooling validation:

- `schemas/fbcli-manifest.schema.v1.json`
- `schemas/fbcli-manifest.v1.json`

Generate current manifest payload:

```bash
npm run manifest
```

### Recommended bootstrap flow for Codex/ClaudeCode

1. Call `fbcli help --json`
2. Select target command by stable `id`
3. Instantiate example/recipe template placeholders
4. Execute command and parse response using `output_contract`

Insights and report commands include:

- automatic pagination by default
- `--no-all-pages` to disable full pagination
- `--max-pages <n>` to cap pagination depth
- computed KPI output (`ctr`, `cpc`, `cpm`) in `kpis`

Deep-dive report slimming flags:

- `--summary-only` to suppress row-level `data.data` and `kpis.rows`
- `--totals-only` (alias `--total-only`) to return only `kpis.totals` (no highlights)
- `--top <n>` to control highlight list size (default `5`)
- `--min-impressions <n>` to exclude low-volume rows
- `--sort-by spend|ctr|cpc` for row/highlight ranking
- `--sort-order asc|desc` (default `desc`)

If you pipe to `jq`, use npm silent mode so npm log lines do not break JSON parsing:

```bash
npm run --silent dev -- report creative-deep-dive --account act_<AD_ACCOUNT_ID> --date-preset last_30d --summary-only --top 10 --min-impressions 1000 --sort-by ctr --sort-order desc | jq '{meta,data,highlights,kpis:{totals:.kpis.totals}}'

# no jq needed if you only want totals
npm run --silent dev -- report creative-deep-dive --account act_<AD_ACCOUNT_ID> --date-preset last_30d --totals-only
```

## Environment

- `FBCLI_ACCESS_TOKEN` (optional; overrides stored token from `fbcli auth login`)
- `FBCLI_API_VERSION` (optional, defaults to `v25.0`)
- `FB_APP_ID` (required for `fbcli auth login` unless passed as flag)
- `FB_APP_SECRET` (required for `fbcli auth login` unless passed as flag)
- `FB_REDIRECT_URI` (optional, defaults to `http://localhost:53682/auth/facebook/callback`)
- `FBCLI_AUTH_FILE` (optional path override for local token file)
- `FBCLI_RATE_LIMIT_ENABLED` (optional, defaults to `true`)
- `FBCLI_ADS_API_ACCESS_TIER` (optional, `development_access` or `standard_access`, defaults to `development_access`)
- `FBCLI_RATE_RETRY_MAX_ATTEMPTS` (optional, defaults to `5`)
- `FBCLI_RATE_RETRY_BASE_MS` (optional, defaults to `1000`)
- `FBCLI_RATE_RETRY_MAX_MS` (optional, defaults to `120000`)
- `FBCLI_RATE_RETRY_JITTER_MS` (optional, defaults to `250`)
- `FBCLI_RATE_SCORE_WINDOW_SECONDS` (optional, defaults to `300`)
- `FBCLI_RATE_DEV_MAX_SCORE` (optional, defaults to `60`)
- `FBCLI_RATE_STANDARD_MAX_SCORE` (optional, defaults to `9000`)
- `FBCLI_RATE_DEV_BLOCK_SECONDS` (optional, defaults to `300`)
- `FBCLI_RATE_STANDARD_BLOCK_SECONDS` (optional, defaults to `60`)
- `FBCLI_MUTATION_QPS_LIMIT` (optional, defaults to `100`)

Quick auth bootstrap:

```bash
export FB_APP_ID='<your_app_id>'
export FB_APP_SECRET='<your_app_secret>'
fbcli auth login
fbcli auth status
```

Authentication design and setup guide:

- `AUTH_FLOW.md`

## Rate limiting behavior

`fbcli` now applies Meta-aware client-side protections in `GraphApiClient`:

- Per ad account score pacing using the 300s score window model (read=1, write=3).
- Access tier-aware score ceilings (`development_access` vs `standard_access`).
- Mutation burst guardrail for campaign/adset/ad mutation endpoints (100 QPS per app+ad-account by default).
- Retry/backoff for known Meta throttling signals (codes `4`, `17`, `613`, `80000`, `80003`, `80004`, `80014` and documented subcodes).
- Header-aware backoff using `Retry-After`, `X-Ad-Account-Usage`, `X-Business-Use-Case`, and `X-FB-Ads-Insights-Throttle` when available.

If you need less strict local pacing while debugging, set `FBCLI_RATE_LIMIT_ENABLED=false`.

## Facebook App Access Notes

For Facebook Marketing API access, keep these permissions enabled in your app and granted on the active token:

- `ads_read`
- `ads_management`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`
- `public_profile` (auto)
- `email` (only if needed)

### Token type matters

- Use a **user access token** for user/business/ad-account reads (for example `/me/businesses`, `act_<AD_ACCOUNT_ID>/insights`, `act_<AD_ACCOUNT_ID>/campaigns`).
- Use a **page access token** for page ad endpoints (for example `/<PAGE_ID>/ads_posts`).

`pages_manage_ads` may return `(#200) Not enough permission` when using a user token, even if the scope is granted. Fetch page tokens from `/me/accounts` and call page endpoints with that token.

### Versioning

Pin a current Graph API version when testing with raw `curl` requests (for example `v24.0` or newer) to avoid deprecated Ads API errors like `(#2635)`.

### App Review test checklist (proven calls)

```bash
API="v24.0"
BASE="https://graph.facebook.com/${API}"
AD_ACCOUNT="act_${ACT_ID}"

# user token checks
curl -sG "${BASE}/me/permissions" --data-urlencode "access_token=${TOKEN}" | jq .
curl -sG "${BASE}/me/accounts" --data-urlencode "access_token=${TOKEN}" --data-urlencode "fields=id,name" | jq .
curl -sG "${BASE}/${PAGE_ID}" --data-urlencode "access_token=${TOKEN}" --data-urlencode "fields=id,name,fan_count" | jq .
curl -sG "${BASE}/me/businesses" --data-urlencode "access_token=${TOKEN}" --data-urlencode "fields=id,name" | jq .
curl -sG "${BASE}/${AD_ACCOUNT}/insights" --data-urlencode "access_token=${TOKEN}" --data-urlencode "fields=impressions,spend" --data-urlencode "date_preset=last_7d" --data-urlencode "limit=1" | jq .
curl -sG "${BASE}/${AD_ACCOUNT}/campaigns" --data-urlencode "access_token=${TOKEN}" --data-urlencode "fields=id,name,status" --data-urlencode "limit=1" | jq .

# page token check (pages_manage_ads)
curl -sG "${BASE}/${PAGE_ID}/ads_posts" --data-urlencode "access_token=${PAGE_TOKEN}" --data-urlencode "fields=id,created_time" --data-urlencode "limit=1" | jq .
```

After running tests, refresh the App Dashboard "Tests" panel (it can lag a few minutes).

Security note: never commit access tokens, and rotate/revoke tokens that were exposed in terminal output or logs.

## Install & Run

```bash
npm install
npm run dev -- nodes list

# local CI-equivalent check
npm run ci:check
```

## MVP guardrail

The CLI is strict read-only in MVP. Unsupported edges return `UNSUPPORTED_IN_MVP`.
