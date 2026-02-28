import { describe, expect, it } from "bun:test";
import { runCli } from "../../src/cli/app.js";
import { type AuthWorkflow } from "../../src/auth-workflow.js";
import { type MetaApiClient, type QueryParams } from "../../src/meta/client.js";

class MockClient implements MetaApiClient {
  calls: Array<{ path: string; params?: QueryParams }> = [];

  async get(path: string, params?: QueryParams): Promise<unknown> {
    this.calls.push({ path, params });
    return { data: [{ path, params }] };
  }
}

function parseStdoutJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout);
}

async function execute(argv: string[], client = new MockClient(), authWorkflow?: AuthWorkflow) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await runCli(argv, client, {
    stdout: (line: string) => stdout.push(line),
    stderr: (line: string) => stderr.push(line),
  }, authWorkflow ? { authWorkflow } : {});

  return {
    result,
    client,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

describe("fbcli commands", () => {
  it("runs auth login with auth workflow", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const authWorkflow: AuthWorkflow = {
      login: async (input) => {
        calls.push(input as Record<string, unknown>);
        return {
          source: "store",
          redirectUri: "http://localhost:53682/auth/facebook/callback",
          apiVersion: "v25.0",
          authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
          grantedPermissions: ["ads_management"],
          declinedPermissions: [],
        };
      },
      status: async () => ({
        authenticated: false,
        source: "none",
        apiVersion: "v25.0",
      }),
      logout: async () => ({
        removedStoredToken: false,
      }),
    };

    const { result, stdout } = await execute(["auth", "login", "--no-open"], new MockClient(), authWorkflow);

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("meta.command", "auth login");
    expect(payload).toHaveProperty("data.source", "store");
  });

  it("runs auth status with auth workflow", async () => {
    const authWorkflow: AuthWorkflow = {
      login: async () => ({
        source: "store",
        redirectUri: "http://localhost:53682/auth/facebook/callback",
        apiVersion: "v25.0",
        authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
        grantedPermissions: ["ads_management"],
        declinedPermissions: [],
      }),
      status: async () => ({
        authenticated: true,
        source: "store",
        apiVersion: "v25.0",
      }),
      logout: async () => ({
        removedStoredToken: false,
      }),
    };

    const { result, stdout } = await execute(["auth", "status", "--skip-api-check"], new MockClient(), authWorkflow);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("meta.command", "auth status");
    expect(payload).toHaveProperty("data.authenticated", true);
  });

  it("runs auth logout with auth workflow", async () => {
    const authWorkflow: AuthWorkflow = {
      login: async () => ({
        source: "store",
        redirectUri: "http://localhost:53682/auth/facebook/callback",
        apiVersion: "v25.0",
        authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
        grantedPermissions: ["ads_management"],
        declinedPermissions: [],
      }),
      status: async () => ({
        authenticated: false,
        source: "none",
        apiVersion: "v25.0",
      }),
      logout: async () => ({
        removedStoredToken: true,
      }),
    };

    const { result, stdout } = await execute(["auth", "logout"], new MockClient(), authWorkflow);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("meta.command", "auth logout");
    expect(payload).toHaveProperty("data.removedStoredToken", true);
  });

  it("returns full manifest for help --json", async () => {
    const { result, stdout } = await execute(["help", "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("manifest_version", "1.0.0");
    expect(payload).toHaveProperty("commands");
    expect(payload).toHaveProperty("recipes");
  });

  it("treats --version as successful control flow", async () => {
    const { result, stderr } = await execute(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("supports help --json --command-id", async () => {
    const { result, stdout } = await execute([
      "help",
      "--json",
      "--command-id",
      "report.creative-deep-dive",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("manifest_version", "1.0.0");
    expect(payload).toHaveProperty("command.id", "report.creative-deep-dive");
  });

  it("supports help --json --recipe-id", async () => {
    const { result, stdout } = await execute([
      "help",
      "--json",
      "--recipe-id",
      "insights.period_compare",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("manifest_version", "1.0.0");
    expect(payload).toHaveProperty("recipe.id", "insights.period_compare");
  });

  it("supports help --json --errors-only", async () => {
    const { result, stdout } = await execute(["help", "--json", "--errors-only"]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("manifest_version", "1.0.0");
    expect(payload).toHaveProperty("errors");
    expect(payload).not.toHaveProperty("commands");
  });

  it("lists nodes", async () => {
    const { result, stdout } = await execute(["nodes", "list"]);

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("ad_account");
  });

  it("lists edges for node", async () => {
    const { result, stdout } = await execute(["edges", "list", "--node", "ad_account"]);

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("insights");
  });

  it("resolves account get", async () => {
    const { client, result } = await execute(["account", "get", "--id", "act_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/act_123");
  });

  it("resolves campaign get", async () => {
    const { client, result } = await execute(["campaign", "get", "--id", "campaign_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/campaign_123");
  });

  it("resolves adset get", async () => {
    const { client, result } = await execute(["adset", "get", "--id", "adset_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/adset_123");
  });

  it("resolves ad get", async () => {
    const { client, result } = await execute(["ad", "get", "--id", "ad_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/ad_123");
  });

  it("resolves creative get", async () => {
    const { client, result } = await execute(["creative", "get", "--id", "creative_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/creative_123");
  });

  it("resolves user adaccounts edge", async () => {
    const { client, result } = await execute(["user", "adaccounts", "--id", "user_123"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/user_123/adaccounts");
  });

  it("runs describe command", async () => {
    const { client, result } = await execute(["describe", "--id", "act_123", "--fields", "id,name"]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/act_123");
    expect(client.calls[0]?.params?.fields).toBe("id,name");
  });

  it("supports describe across all root node types with node-type hint", async () => {
    const scenarios: Array<{ nodeType: string; id: string }> = [
      { nodeType: "campaign", id: "123" },
      { nodeType: "adset", id: "234" },
      { nodeType: "ad", id: "345" },
      { nodeType: "creative", id: "456" },
      { nodeType: "user", id: "567" },
    ];

    for (const scenario of scenarios) {
      const { client, result } = await execute([
        "describe",
        "--id",
        scenario.id,
        "--node-type",
        scenario.nodeType,
      ]);

      expect(result.exitCode).toBe(0);
      expect(client.calls[0]?.path).toBe(`/${scenario.id}`);
    }
  });

  it("runs insights query command", async () => {
    const { client, result, stdout } = await execute([
      "insights",
      "query",
      "--node",
      "act_123",
      "--fields",
      "impressions,clicks,spend",
      "--breakdowns",
      "age,gender",
    ]);

    expect(result.exitCode).toBe(0);
    expect(client.calls[0]?.path).toBe("/act_123/insights");
    expect(client.calls[0]?.params?.breakdowns).toBe("age,gender");

    const payload = parseStdoutJson(stdout);
    expect(payload).toHaveProperty("kpis");
  });

  it("auto paginates insights by default", async () => {
    const client: MetaApiClient = {
      get: async (_path: string, params?: QueryParams): Promise<unknown> => {
        if (params?.after === "CUR2") {
          return {
            data: [{ impressions: "30", clicks: "3", spend: "15" }],
            paging: {
              cursors: {
                before: "CUR1",
                after: "CUR2",
              },
            },
          };
        }

        return {
          data: [{ impressions: "20", clicks: "2", spend: "10" }],
          paging: {
            cursors: {
              before: "CUR0",
              after: "CUR2",
            },
            next: "https://graph.facebook.com/v25.0/next?page=2",
          },
        };
      },
    };

    const { result, stdout } = await execute([
      "insights",
      "query",
      "--node",
      "act_123",
      "--fields",
      "impressions,clicks,spend",
    ], client);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    const data = payload.data as { data: unknown[] };
    const meta = payload.meta as { pagination: { pagesFetched: number } };

    expect(data.data).toHaveLength(2);
    expect(meta.pagination.pagesFetched).toBe(2);
  });

  it("supports campaign deep-dive report", async () => {
    const { result, stdout } = await execute([
      "report",
      "campaign-deep-dive",
      "--account",
      "act_123",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload.meta).toHaveProperty("command", "report campaign-deep-dive");
    expect(payload).toHaveProperty("kpis");
    expect(payload).toHaveProperty("highlights");
  });

  it("supports adset deep-dive report", async () => {
    const { result, stdout } = await execute([
      "report",
      "adset-deep-dive",
      "--account",
      "act_123",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload.meta).toHaveProperty("command", "report adset-deep-dive");
    expect(payload).toHaveProperty("kpis");
    expect(payload).toHaveProperty("highlights");
  });

  it("supports creative deep-dive report", async () => {
    const { result, stdout } = await execute([
      "report",
      "creative-deep-dive",
      "--account",
      "act_123",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    expect(payload.meta).toHaveProperty("command", "report creative-deep-dive");
    expect(payload).toHaveProperty("kpis");
    expect(payload).toHaveProperty("highlights");
  });

  it("supports summary-only, top, min-impressions, and sort flags", async () => {
    const client: MetaApiClient = {
      get: async (): Promise<unknown> => ({
        data: [
          { ad_id: "a1", ad_name: "A", impressions: "50", clicks: "10", spend: "100" },
          { ad_id: "a2", ad_name: "B", impressions: "5", clicks: "1", spend: "5" },
          { ad_id: "a3", ad_name: "C", impressions: "100", clicks: "5", spend: "20" },
        ],
        paging: {
          cursors: { before: "B", after: "A" },
        },
      }),
    };

    const { result, stdout } = await execute(
      [
        "report",
        "creative-deep-dive",
        "--account",
        "act_123",
        "--summary-only",
        "--top",
        "1",
        "--min-impressions",
        "10",
        "--sort-by",
        "ctr",
        "--sort-order",
        "desc",
      ],
      client,
    );

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    const data = payload.data as Record<string, unknown>;
    const highlights = payload.highlights as { top: unknown[] };
    const meta = payload.meta as { report_options: { min_impressions: number; summary_only: boolean } };
    const kpis = payload.kpis as Record<string, unknown>;

    expect(data).not.toHaveProperty("data");
    expect(data.row_count).toBe(2);
    expect(highlights.top).toHaveLength(1);
    expect(kpis).not.toHaveProperty("rows");
    expect(kpis).toHaveProperty("totals");
    expect(meta.report_options.min_impressions).toBe(10);
    expect(meta.report_options.summary_only).toBe(true);
  });

  it("supports totals-only flag", async () => {
    const client: MetaApiClient = {
      get: async (): Promise<unknown> => ({
        data: [
          { ad_id: "a1", ad_name: "A", impressions: "50", clicks: "10", spend: "100" },
          { ad_id: "a2", ad_name: "B", impressions: "20", clicks: "2", spend: "10" },
        ],
        paging: {
          cursors: { before: "B", after: "A" },
        },
      }),
    };

    const { result, stdout } = await execute(
      [
        "report",
        "creative-deep-dive",
        "--account",
        "act_123",
        "--totals-only",
      ],
      client,
    );

    expect(result.exitCode).toBe(0);
    const payload = parseStdoutJson(stdout);
    const data = payload.data as Record<string, unknown>;
    const meta = payload.meta as {
      report_options: { summary_only: boolean; totals_only: boolean };
    };
    const kpis = payload.kpis as Record<string, unknown>;

    expect(data).not.toHaveProperty("data");
    expect(kpis).toHaveProperty("totals");
    expect(kpis).not.toHaveProperty("rows");
    expect(kpis).not.toHaveProperty("rowCount");
    expect(payload).not.toHaveProperty("highlights");
    expect(meta.report_options.summary_only).toBe(true);
    expect(meta.report_options.totals_only).toBe(true);
  });

  it("returns clear error for ambiguous numeric ID", async () => {
    const { result, stderr } = await execute(["describe", "--id", "12345"]);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("AMBIGUOUS_GRAPH_ID");
  });

  it("returns clear error when edge does not exist for node", async () => {
    const { result, stderr } = await execute(["insights", "query", "--node", "user_123"]);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("EDGE_NOT_SUPPORTED");
  });
});
