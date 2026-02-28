import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { FbCliError } from "./errors/fbcli-error.js";

export const DEFAULT_AUTH_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "public_profile",
] as const;

export const DEFAULT_REDIRECT_URI = "http://localhost:53682/auth/facebook/callback";

type StoredAuth = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  api_version: string;
  scopes: string[];
  obtained_at: string;
};

type ResolveTokenResult = {
  source: "env" | "store" | "none";
  accessToken?: string;
  storedAuth?: StoredAuth;
  hasStoredToken: boolean;
};

export type AuthLoginInput = {
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  apiVersion?: string;
  timeoutSeconds?: number;
  openBrowser?: boolean;
  forceRerequest?: boolean;
};

export type AuthLoginResult = {
  source: "store";
  redirectUri: string;
  apiVersion: string;
  authUrl: string;
  expiresIn?: number;
  expiresAt?: string;
  tokenType?: string;
  grantedPermissions: string[];
  declinedPermissions: string[];
};

export type AuthStatusInput = {
  apiVersion?: string;
  skipApiCheck?: boolean;
};

export type AuthStatusResult = {
  authenticated: boolean;
  source: "env" | "store" | "none";
  expiresAt?: string;
  apiVersion: string;
  profile?: {
    id?: string;
    name?: string;
  };
  grantedPermissions?: string[];
  declinedPermissions?: string[];
};

export type AuthLogoutResult = {
  removedStoredToken: boolean;
};

export interface AuthWorkflow {
  login(input: AuthLoginInput): Promise<AuthLoginResult>;
  status(input: AuthStatusInput): Promise<AuthStatusResult>;
  logout(): Promise<AuthLogoutResult>;
}

type OAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type GraphErrorPayload = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
};

type GraphPermissionsPayload = {
  data?: Array<{ permission?: string; status?: string }>;
};

type GraphProfilePayload = {
  id?: string;
  name?: string;
};

function resolveAuthFilePath(): string {
  const fromEnv = process.env.FBCLI_AUTH_FILE?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return join(homedir(), ".config", "fbcli", "auth.json");
}

function loadStoredAuth(): StoredAuth | null {
  const authFile = resolveAuthFilePath();
  if (!existsSync(authFile)) {
    return null;
  }

  try {
    const raw = readFileSync(authFile, "utf8");
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed.access_token || typeof parsed.access_token !== "string") {
      return null;
    }

    return parsed;
  } catch (error) {
    throw new FbCliError("AUTH_STORAGE_ERROR", "Unable to read saved fbcli auth token.", {
      authFile,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function saveStoredAuth(record: StoredAuth): void {
  const authFile = resolveAuthFilePath();

  try {
    mkdirSync(dirname(authFile), { recursive: true });
    writeFileSync(authFile, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    throw new FbCliError("AUTH_STORAGE_ERROR", "Unable to persist fbcli auth token.", {
      authFile,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function clearStoredAuth(): boolean {
  const authFile = resolveAuthFilePath();
  if (!existsSync(authFile)) {
    return false;
  }

  try {
    rmSync(authFile);
    return true;
  } catch (error) {
    throw new FbCliError("AUTH_STORAGE_ERROR", "Unable to remove saved fbcli auth token.", {
      authFile,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function resolveAccessTokenForCli(): ResolveTokenResult {
  const storedAuth = loadStoredAuth();
  const hasStoredToken = Boolean(storedAuth?.access_token);
  const envToken = process.env.FBCLI_ACCESS_TOKEN?.trim();
  if (envToken) {
    return {
      source: "env",
      accessToken: envToken,
      storedAuth: storedAuth ?? undefined,
      hasStoredToken,
    };
  }

  if (storedAuth?.access_token) {
    return {
      source: "store",
      accessToken: storedAuth.access_token,
      storedAuth,
      hasStoredToken,
    };
  }

  return {
    source: "none",
    hasStoredToken,
  };
}

function normalizeScopes(scopes?: string[]): string[] {
  const source = scopes && scopes.length > 0 ? scopes : Array.from(DEFAULT_AUTH_SCOPES);

  return source
    .flatMap((scope) => scope.split(","))
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildAuthUrl(options: {
  appId: string;
  redirectUri: string;
  scopes: string[];
  apiVersion: string;
  state: string;
  forceRerequest: boolean;
}): string {
  const authUrl = new URL(`https://www.facebook.com/${options.apiVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", options.appId);
  authUrl.searchParams.set("redirect_uri", options.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", options.scopes.join(","));
  authUrl.searchParams.set("state", options.state);
  if (options.forceRerequest) {
    authUrl.searchParams.set("auth_type", "rerequest");
  }

  return authUrl.toString();
}

function openUrl(url: string): boolean {
  const commandMatrix: Array<{ command: string; args: string[] }> = [];

  if (process.platform === "darwin") {
    commandMatrix.push({ command: "open", args: [url] });
  }

  if (process.platform === "win32") {
    commandMatrix.push({ command: "cmd", args: ["/c", "start", "", url] });
  }

  commandMatrix.push({ command: "xdg-open", args: [url] });

  for (const candidate of commandMatrix) {
    try {
      const child = spawn(candidate.command, candidate.args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    } catch (_error) {
      continue;
    }
  }

  return false;
}

async function waitForAuthorizationCode(redirectUri: string, expectedState: string, timeoutMs: number): Promise<string> {
  const callbackUrl = new URL(redirectUri);
  const host = callbackUrl.hostname;
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (callbackUrl.protocol !== "http:" || !allowedHosts.has(host)) {
    throw new FbCliError(
      "AUTH_CALLBACK_LISTENER_ERROR",
      "fbcli local OAuth callback only supports http://localhost or loopback hosts.",
      { redirectUri },
    );
  }

  const callbackPath = callbackUrl.pathname || "/";
  const callbackPort = callbackUrl.port ? Number.parseInt(callbackUrl.port, 10) : 80;

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (resolver: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      server.close(() => resolver());
    };

    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", callbackUrl.origin);
        if (requestUrl.pathname !== callbackPath) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        const oauthError = requestUrl.searchParams.get("error");
        const oauthErrorDescription = requestUrl.searchParams.get("error_description");
        if (oauthError) {
          response.statusCode = 400;
          response.end("Facebook OAuth was denied. You can close this tab.");
          finish(() =>
            reject(
              new FbCliError("AUTH_CALLBACK_LISTENER_ERROR", oauthErrorDescription ?? oauthError, {
                error: oauthError,
              }),
            ),
          );
          return;
        }

        const state = requestUrl.searchParams.get("state");
        if (state !== expectedState) {
          response.statusCode = 400;
          response.end("OAuth state mismatch. You can close this tab.");
          finish(() => reject(new FbCliError("AUTH_STATE_MISMATCH", "OAuth state mismatch.")));
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          response.statusCode = 400;
          response.end("Missing authorization code. You can close this tab.");
          finish(() =>
            reject(new FbCliError("AUTH_CALLBACK_LISTENER_ERROR", "Missing OAuth authorization code.")),
          );
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end("<html><body><h1>fbcli authentication complete</h1><p>You can close this tab.</p></body></html>");
        finish(() => resolve(code));
      } catch (error) {
        response.statusCode = 500;
        response.end("OAuth callback processing failed.");
        finish(() =>
          reject(
            new FbCliError("AUTH_CALLBACK_LISTENER_ERROR", "OAuth callback processing failed.", {
              message: error instanceof Error ? error.message : "Unknown error",
            }),
          ),
        );
      }
    });

    server.on("error", (error) => {
      finish(() =>
        reject(
          new FbCliError("AUTH_CALLBACK_LISTENER_ERROR", "Unable to start local OAuth callback server.", {
            redirectUri,
            message: error.message,
          }),
        ),
      );
    });

    server.listen(callbackPort, host);

    const timeoutHandle = setTimeout(() => {
      finish(() =>
        reject(
          new FbCliError("AUTH_CALLBACK_TIMEOUT", "Timed out waiting for Facebook OAuth callback.", {
            timeoutMs,
            redirectUri,
          }),
        ),
      );
    }, timeoutMs);
  });
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = (await response.json()) as GraphErrorPayload;
  if (!response.ok || payload.error) {
    throw new FbCliError("AUTH_TOKEN_EXCHANGE_FAILED", payload.error?.message ?? "Meta OAuth request failed.", {
      status: response.status,
      metaCode: payload.error?.code,
      metaSubcode: payload.error?.error_subcode,
      url: url.pathname,
    });
  }

  return payload;
}

async function exchangeCodeForToken(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
  apiVersion: string;
}): Promise<OAuthTokenResponse> {
  const tokenUrl = new URL(`https://graph.facebook.com/${input.apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", input.appId);
  tokenUrl.searchParams.set("client_secret", input.appSecret);
  tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
  tokenUrl.searchParams.set("code", input.code);

  const payload = (await fetchJson(tokenUrl)) as OAuthTokenResponse;

  if (!payload.access_token) {
    throw new FbCliError("AUTH_TOKEN_EXCHANGE_FAILED", "Meta OAuth response did not include access_token.", {
      apiVersion: input.apiVersion,
    });
  }

  return payload;
}

async function fetchPermissions(accessToken: string, apiVersion: string): Promise<GraphPermissionsPayload> {
  const permissionsUrl = new URL(`https://graph.facebook.com/${apiVersion}/me/permissions`);
  permissionsUrl.searchParams.set("access_token", accessToken);

  return (await fetchJson(permissionsUrl)) as GraphPermissionsPayload;
}

async function fetchProfile(accessToken: string, apiVersion: string): Promise<GraphProfilePayload> {
  const profileUrl = new URL(`https://graph.facebook.com/${apiVersion}/me`);
  profileUrl.searchParams.set("access_token", accessToken);
  profileUrl.searchParams.set("fields", "id,name");

  return (await fetchJson(profileUrl)) as GraphProfilePayload;
}

function resolveGrantedAndDeclinedPermissions(payload: GraphPermissionsPayload): {
  grantedPermissions: string[];
  declinedPermissions: string[];
} {
  const grantedPermissions: string[] = [];
  const declinedPermissions: string[] = [];

  for (const item of payload.data ?? []) {
    if (!item.permission || !item.status) {
      continue;
    }

    if (item.status === "granted") {
      grantedPermissions.push(item.permission);
      continue;
    }

    declinedPermissions.push(item.permission);
  }

  grantedPermissions.sort();
  declinedPermissions.sort();

  return { grantedPermissions, declinedPermissions };
}

export function createAuthWorkflow(): AuthWorkflow {
  return {
    async login(input: AuthLoginInput): Promise<AuthLoginResult> {
      const appId = input.appId?.trim() || process.env.FB_APP_ID?.trim();
      const appSecret = input.appSecret?.trim() || process.env.FB_APP_SECRET?.trim();
      const redirectUri = input.redirectUri?.trim() || process.env.FB_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
      const apiVersion = input.apiVersion?.trim() || process.env.FBCLI_API_VERSION?.trim() || "v25.0";
      const timeoutSeconds = Math.max(1, input.timeoutSeconds ?? 180);
      const scopes = normalizeScopes(input.scopes);
      const forceRerequest = input.forceRerequest !== false;

      if (!appId || !appSecret) {
        throw new FbCliError(
          "MISSING_APP_CREDENTIALS",
          "Missing app credentials. Set FB_APP_ID and FB_APP_SECRET or pass --app-id/--app-secret.",
        );
      }

      const state = randomBytes(24).toString("hex");
      const authUrl = buildAuthUrl({
        appId,
        redirectUri,
        scopes,
        apiVersion,
        state,
        forceRerequest,
      });

      if (input.openBrowser !== false) {
        openUrl(authUrl);
      }

      const code = await waitForAuthorizationCode(redirectUri, state, timeoutSeconds * 1000);
      const tokenResponse = await exchangeCodeForToken({
        appId,
        appSecret,
        code,
        redirectUri,
        apiVersion,
      });

      const permissions = await fetchPermissions(tokenResponse.access_token, apiVersion);
      const { grantedPermissions, declinedPermissions } = resolveGrantedAndDeclinedPermissions(permissions);

      const obtainedAt = new Date();
      const expiresAt =
        typeof tokenResponse.expires_in === "number"
          ? new Date(obtainedAt.getTime() + tokenResponse.expires_in * 1000)
          : undefined;

      saveStoredAuth({
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        api_version: apiVersion,
        scopes,
        obtained_at: obtainedAt.toISOString(),
      });

      return {
        source: "store",
        redirectUri,
        apiVersion,
        authUrl,
        expiresIn: tokenResponse.expires_in,
        expiresAt: expiresAt?.toISOString(),
        tokenType: tokenResponse.token_type,
        grantedPermissions,
        declinedPermissions,
      };
    },

    async status(input: AuthStatusInput): Promise<AuthStatusResult> {
      const resolved = resolveAccessTokenForCli();
      const apiVersion = input.apiVersion?.trim() || process.env.FBCLI_API_VERSION?.trim() || "v25.0";

      if (resolved.source === "none" || !resolved.accessToken) {
        return {
          authenticated: false,
          source: "none",
          apiVersion,
        };
      }

      const skipApiCheck = input.skipApiCheck === true;
      if (skipApiCheck) {
        const expiresAt =
          resolved.source === "store" &&
          typeof resolved.storedAuth?.expires_in === "number" &&
          resolved.storedAuth.obtained_at
            ? new Date(
                new Date(resolved.storedAuth.obtained_at).getTime() + resolved.storedAuth.expires_in * 1000,
              ).toISOString()
            : undefined;

        return {
          authenticated: true,
          source: resolved.source,
          apiVersion,
          expiresAt,
        };
      }

      let profile: GraphProfilePayload;
      let permissions: GraphPermissionsPayload;
      try {
        [profile, permissions] = await Promise.all([
          fetchProfile(resolved.accessToken, apiVersion),
          fetchPermissions(resolved.accessToken, apiVersion),
        ]);
      } catch (error) {
        if (
          error instanceof FbCliError &&
          error.code === "AUTH_TOKEN_EXCHANGE_FAILED" &&
          resolved.source === "env" &&
          resolved.hasStoredToken
        ) {
          throw new FbCliError(error.code, error.message, {
            ...error.details,
            hint:
              "FBCLI_ACCESS_TOKEN is set and overrides your saved login. Unset FBCLI_ACCESS_TOKEN to use stored auth token.",
          });
        }

        throw error;
      }
      const { grantedPermissions, declinedPermissions } = resolveGrantedAndDeclinedPermissions(permissions);

      const expiresAt =
        resolved.source === "store" &&
        typeof resolved.storedAuth?.expires_in === "number" &&
        resolved.storedAuth.obtained_at
          ? new Date(new Date(resolved.storedAuth.obtained_at).getTime() + resolved.storedAuth.expires_in * 1000).toISOString()
          : undefined;

      return {
        authenticated: true,
        source: resolved.source,
        apiVersion,
        expiresAt,
        profile: {
          id: profile.id,
          name: profile.name,
        },
        grantedPermissions,
        declinedPermissions,
      };
    },

    async logout(): Promise<AuthLogoutResult> {
      return {
        removedStoredToken: clearStoredAuth(),
      };
    },
  };
}
