# fbcli Authentication Flow (2026)

This document defines how `fbcli` should authenticate against the Facebook Graph/Marketing API using a bring-your-own-app model.

## Goal

Each operator uses their own Facebook app in Developer Mode, grants permissions to their own account, and runs `fbcli` with their own app credentials and tokens.

This avoids sharing a central app secret and keeps account-level access boundaries clear.

## Why not Graph API Explorer flow

Graph API Explorer is fine for manual testing, but `fbcli` should not depend on Explorer callback URLs or implicit token URLs (`response_type=token`).

Use app-owned OAuth authorization code flow (`response_type=code`) so the redirect URI and token exchange are controlled by `fbcli`.

## Required app configuration

In **Facebook Login > Settings**:

- `Client OAuth Login`: `Yes`
- `Web OAuth Login`: `Yes`
- `Strict Mode for Redirect URIs`: `Yes`
- `Force Web OAuth Reauthentication`: `No`
- `Embedded Browser OAuth Login`: `No`
- `Device Login`: `No`
- `JavaScript SDK Login`: `No`

`Aplicar HTTPS`:

- local CLI callback on `http://localhost`: keep `No` during local development
- hosted production callback on `https://...`: set `Yes`

## Redirect URI policy

Facebook behavior differs by mode:

- In **Development mode**, `http://localhost` redirect URIs are allowed automatically and do not need to be added in **Valid OAuth Redirect URIs**.
- For non-local environments (staging/production), add exact `https://...` callback URI(s) in **Valid OAuth Redirect URIs**.

For local testing, keep a fixed redirect in CLI config.

Example:

- `http://localhost:53682/auth/facebook/callback`
- `http://127.0.0.1:53682/auth/facebook/callback`

The `redirect_uri` sent in OAuth must match exactly (scheme, host, port, path, trailing slash behavior).

## Scopes

Minimum scopes used by current `fbcli` review/testing paths:

- `ads_read`
- `ads_management`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`
- `public_profile` (automatic)
- `email` (optional)

## OAuth flow for `fbcli`

Primary commands:

- `fbcli auth login`
- `fbcli auth status`
- `fbcli auth logout`

1. User runs `fbcli auth login`.
2. CLI opens:
   - `https://www.facebook.com/v25.0/dialog/oauth`
   - with `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`.
3. Facebook redirects to local callback with `code`.
4. CLI exchanges `code` at Graph token endpoint using app secret.
5. CLI stores resulting token securely.
6. CLI validates scopes via `/me/permissions`.

After login, API commands automatically use saved token unless `FBCLI_ACCESS_TOKEN` is explicitly set.

Use `auth_type=rerequest` when re-requesting declined scopes.

## Token usage rules

- Use **user access token** for:
  - `/me/businesses`
  - `act_<AD_ACCOUNT_ID>/insights`
  - `act_<AD_ACCOUNT_ID>/campaigns`
- Use **page access token** for page ad endpoints such as:
  - `/<PAGE_ID>/ads_posts`

If `pages_manage_ads` is granted but `/<PAGE_ID>/ads_posts` returns `(#200) Not enough permission`, verify you are using a page token from `/me/accounts` and that the user has ad-related page tasks.

## API versioning

Pin a current Graph API version (for example `v24.0` or `v25.0`) in all API calls.

Older/unpinned Ads calls can fail with deprecation error `(#2635)`.

## Runtime rate limiting in fbcli

`fbcli` applies client-side rate controls aligned with Meta docs:

- ad-account score pacing in the 300-second window model
- access-tier-aware score ceilings (`development_access`/`standard_access`)
- mutation burst guardrail (`FBCLI_MUTATION_QPS_LIMIT`, default `100`)
- automatic retry/backoff for documented throttling code/subcode families

Backoff also reads these headers when present:

- `Retry-After`
- `X-Ad-Account-Usage`
- `X-Business-Use-Case`
- `X-FB-Ads-Insights-Throttle`

## Security

- Never commit access tokens or app secrets.
- Never paste live tokens in docs/issues.
- Rotate/revoke tokens immediately if exposed in terminal output, logs, or chat.
- Prefer OS keychain/secret store over plaintext files.

## Suggested CLI environment variables

- `FB_APP_ID`
- `FB_APP_SECRET`
- `FB_REDIRECT_URI`
- `FBCLI_API_VERSION` (default `v25.0`)
- `FBCLI_ACCESS_TOKEN` (for non-interactive/manual mode)

## App Review evidence checklist

Collect and retain output proving at least one successful call per requested scope/feature bucket:

- `pages_show_list`: `/me/accounts`
- `pages_read_engagement`: `/<PAGE_ID>?fields=id,name,fan_count`
- `pages_manage_ads`: `/<PAGE_ID>/ads_posts` (page token)
- `business_management`: `/me/businesses`
- `ads_read`: `/act_<ID>/insights`
- `ads_management`: `/act_<ID>/campaigns`

After running tests, refresh App Dashboard **Tests** and wait a few minutes for counters to update.
