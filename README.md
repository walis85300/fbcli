# fbcli

[![CI](https://github.com/r-po/fbcli/actions/workflows/ci.yml/badge.svg)](https://github.com/r-po/fbcli/actions/workflows/ci.yml)

Read-only Facebook Marketing API CLI designed for humans and agents.

## Project status

- Scope: read-only workflows only (no create/update/delete mutations in CLI commands).
- Maturity: early-stage but tested (`npm run ci:check`).
- Target user: developers/agents who need predictable JSON contracts for Ads data extraction.

## Features

- Stable command discovery via `fbcli help --json`
- Manifest + JSON schema artifacts for tool integration
- Insights/report commands with built-in pagination controls
- Computed KPI output (`ctr`, `cpc`, `cpm`)
- Meta-aware client-side rate limiting and retry/backoff

## Quick start

### Prerequisites

- Node.js 22+
- npm
- Facebook app credentials with the right Marketing API scopes

### Install and run locally

```bash
git clone https://github.com/r-po/fbcli.git
cd fbcli
npm install

# run in dev mode
npm run dev -- help --json
npm run dev -- nodes list
```

### Build and test

```bash
npm run build
npm run test
npm run ci:check
```

## Authentication

Set app credentials, then log in:

```bash
export FB_APP_ID='<your_app_id>'
export FB_APP_SECRET='<your_app_secret>'
fbcli auth login
fbcli auth status
```

Reference guide: `AUTH_FLOW.md`

## Command reference

```bash
fbcli help --json
fbcli auth login
fbcli auth status
fbcli auth logout
fbcli nodes list
fbcli edges list --node <type>
fbcli describe --id <GRAPH_ID> --fields <csv> [--node-type <type>]
fbcli account get --id act_<AD_ACCOUNT_ID>
fbcli campaign get --id <AD_CAMPAIGN_ID>
fbcli adset get --id <AD_SET_ID>
fbcli ad get --id <AD_ID>
fbcli creative get --id <AD_CREATIVE_ID>
fbcli user adaccounts --id <AD_ACCOUNT_USER_ID>
fbcli insights query --node <ID> [--node-type <type>]
fbcli report campaign-deep-dive --account act_<AD_ACCOUNT_ID>
fbcli report adset-deep-dive --account act_<AD_ACCOUNT_ID>
fbcli report creative-deep-dive --account act_<AD_ACCOUNT_ID>
```

## Agent integration

Canonical discovery:

```bash
fbcli help --json
```

Focused filters:

```bash
fbcli help --json --command-id report.creative-deep-dive
fbcli help --json --recipe-id insights.period_compare
fbcli help --json --errors-only
```

Bootstrap flow for agents:

1. Call `fbcli help --json`
2. Select command by stable `id`
3. Fill template placeholders from examples/recipes
4. Execute and parse using `output_contract`

### Manifest contract

- `manifest_version` is currently `1.0.0`
- Breaking contract changes require a major version bump
- Same major version supports additive fields only
- Published command `id` values are stable identifiers

Schema artifacts:

- `schemas/fbcli-manifest.schema.v1.json`
- `schemas/fbcli-manifest.v1.json`

Generate the manifest:

```bash
npm run manifest
```

## Reports and pagination behavior

Insights/report commands include:

- automatic pagination by default
- `--no-all-pages` to disable full pagination
- `--max-pages <n>` to cap pagination depth
- computed KPI output (`ctr`, `cpc`, `cpm`) in `kpis`

Deep-dive report slimming flags:

- `--summary-only` to suppress row-level `data.data` and `kpis.rows`
- `--totals-only` (alias `--total-only`) for totals-only output
- `--top <n>` to control highlight list size (default `5`)
- `--min-impressions <n>` to exclude low-volume rows
- `--sort-by spend|ctr|cpc`
- `--sort-order asc|desc` (default `desc`)

If piping to `jq`, use npm silent mode:

```bash
npm run --silent dev -- report creative-deep-dive --account act_<AD_ACCOUNT_ID> --date-preset last_30d --summary-only --top 10 --min-impressions 1000 --sort-by ctr --sort-order desc | jq '{meta,data,highlights,kpis:{totals:.kpis.totals}}'
npm run --silent dev -- report creative-deep-dive --account act_<AD_ACCOUNT_ID> --date-preset last_30d --totals-only
```

## Environment variables

Required for login:

- `FB_APP_ID`
- `FB_APP_SECRET`

Core optional variables:

- `FBCLI_ACCESS_TOKEN` (overrides stored token from `fbcli auth login`)
- `FBCLI_API_VERSION` (default `v25.0`)
- `FB_REDIRECT_URI` (default `http://localhost:53682/auth/facebook/callback`)
- `FBCLI_AUTH_FILE` (custom local token file path)

Rate limiting and retry controls:

- `FBCLI_RATE_LIMIT_ENABLED` (default `true`)
- `FBCLI_ADS_API_ACCESS_TIER` (`development_access` or `standard_access`, default `development_access`)
- `FBCLI_RATE_RETRY_MAX_ATTEMPTS` (default `5`)
- `FBCLI_RATE_RETRY_BASE_MS` (default `1000`)
- `FBCLI_RATE_RETRY_MAX_MS` (default `120000`)
- `FBCLI_RATE_RETRY_JITTER_MS` (default `250`)
- `FBCLI_RATE_SCORE_WINDOW_SECONDS` (default `300`)
- `FBCLI_RATE_DEV_MAX_SCORE` (default `60`)
- `FBCLI_RATE_STANDARD_MAX_SCORE` (default `9000`)
- `FBCLI_RATE_DEV_BLOCK_SECONDS` (default `300`)
- `FBCLI_RATE_STANDARD_BLOCK_SECONDS` (default `60`)
- `FBCLI_MUTATION_QPS_LIMIT` (default `100`)

## Facebook app access notes

Keep these permissions enabled in your app and granted on the active token:

- `ads_read`
- `ads_management`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`
- `public_profile` (auto)
- `email` (if needed)

Token usage:

- Use a user access token for user/business/ad-account reads
- Use a page access token for page ad endpoints (for example `/<PAGE_ID>/ads_posts`)

## Security

- Never commit access tokens or app secrets.
- Rotate/revoke tokens if they appear in logs or shell history.
- Prefer `.env` loading in local shells instead of hardcoding secrets.

## Contributing

Contributions are welcome. Please open an issue first for large changes.

Typical workflow:

1. Fork the repo and create a branch.
2. Run `npm run ci:check` before opening a PR.
3. Include tests for behavior changes.
4. Keep CLI output contracts backward-compatible when possible.

## MVP guardrail

The CLI is strict read-only in MVP. Unsupported edges return `UNSUPPORTED_IN_MVP`.
