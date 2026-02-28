import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthWorkflow } from "../../src/auth-workflow.js";
import { FbCliError } from "../../src/errors/fbcli-error.js";

const originalEnv = {
  FBCLI_AUTH_FILE: process.env.FBCLI_AUTH_FILE,
  FBCLI_ACCESS_TOKEN: process.env.FBCLI_ACCESS_TOKEN,
  FBCLI_API_VERSION: process.env.FBCLI_API_VERSION,
};

afterEach(() => {
  if (originalEnv.FBCLI_AUTH_FILE === undefined) {
    delete process.env.FBCLI_AUTH_FILE;
  } else {
    process.env.FBCLI_AUTH_FILE = originalEnv.FBCLI_AUTH_FILE;
  }

  if (originalEnv.FBCLI_ACCESS_TOKEN === undefined) {
    delete process.env.FBCLI_ACCESS_TOKEN;
  } else {
    process.env.FBCLI_ACCESS_TOKEN = originalEnv.FBCLI_ACCESS_TOKEN;
  }

  if (originalEnv.FBCLI_API_VERSION === undefined) {
    delete process.env.FBCLI_API_VERSION;
  } else {
    process.env.FBCLI_API_VERSION = originalEnv.FBCLI_API_VERSION;
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth workflow", () => {
  it("adds hint when env token fails but stored token exists", async () => {
    const authFilePath = join(tmpdir(), `fbcli-auth-${Date.now()}.json`);
    process.env.FBCLI_AUTH_FILE = authFilePath;
    process.env.FBCLI_ACCESS_TOKEN = "expired-env-token";

    writeFileSync(
      authFilePath,
      JSON.stringify(
        {
          access_token: "valid-stored-token",
          api_version: "v25.0",
          scopes: ["ads_read"],
          obtained_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message:
              "Error validating access token: Session has expired on Wednesday, 25-Feb-26 21:00:00 PST.",
            code: 190,
            error_subcode: 463,
          },
        }),
      })),
    );

    const authWorkflow = createAuthWorkflow();

    try {
      await authWorkflow.status({ apiVersion: "v25.0" });
      throw new Error("Expected status to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FbCliError);
      const typedError = error as FbCliError;
      expect(typedError.code).toBe("AUTH_TOKEN_EXCHANGE_FAILED");
      expect(typedError.details?.hint).toContain("Unset FBCLI_ACCESS_TOKEN");
    } finally {
      rmSync(authFilePath, { force: true });
    }
  });
});

