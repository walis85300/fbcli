import { describe, expect, it, mock } from "bun:test";
import { GraphApiClient } from "../../src/meta/client.js";

describe("GraphApiClient rate limiting", () => {
  it("retries on Meta rate-limit responses with backoff", async () => {
    const sleepCalls: number[] = [];
    const fetchMock = mock<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "There have been too many calls from this app. Wait a bit and try again.",
              code: 4,
              error_subcode: 1504022,
            },
          }),
          {
            status: 400,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "act_123" }],
          }),
          {
            status: 200,
          },
        ),
      );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new GraphApiClient({
      accessToken: "token",
      rateLimit: {
        retryMaxAttempts: 2,
        retryBaseMs: 25,
        retryMaxMs: 100,
        retryJitterMs: 0,
      },
      internals: {
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    });

    const payload = (await client.get("/act_123/insights", { fields: "impressions" })) as { data: unknown[] };

    expect(payload.data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([25]);
  });

  it("paces calls by ad-account score window", async () => {
    let nowMs = 0;
    const sleepCalls: number[] = [];

    const fetchMock = mock<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ ok: true }],
        }),
        {
          status: 200,
        },
      ),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new GraphApiClient({
      accessToken: "token",
      rateLimit: {
        adsApiAccessTier: "development_access",
        scoreWindowSeconds: 10,
        developmentMaxScore: 2,
        developmentBlockSeconds: 0,
        retryMaxAttempts: 1,
        retryJitterMs: 0,
      },
      internals: {
        now: () => nowMs,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          nowMs += ms;
        },
      },
    });

    await client.get("/act_123/campaigns");
    await client.get("/act_123/campaigns");
    await client.get("/act_123/campaigns");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(5000);
    expect(sleepCalls[0]).toBeLessThanOrEqual(5001);
  });
});

