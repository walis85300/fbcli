import { describe, expect, it } from "bun:test";
import { FbCliError } from "../../src/errors/fbcli-error.js";
import { resolveGraphPath } from "../../src/meta/path-resolver.js";

describe("resolveGraphPath", () => {
  it("resolves root path for ad account", () => {
    const resolved = resolveGraphPath({
      nodeType: "ad_account",
      id: "act_12345",
    });

    expect(resolved.path).toBe("/act_12345");
  });

  it("resolves edge path for supported edge", () => {
    const resolved = resolveGraphPath({
      nodeType: "campaign",
      id: "campaign_1",
      edge: "insights",
    });

    expect(resolved.path).toBe("/campaign_1/insights");
  });

  it("throws EDGE_NOT_SUPPORTED for unknown edge", () => {
    expect(() => {
      resolveGraphPath({
        nodeType: "ad",
        id: "ad_1",
        edge: "unknown_edge",
      });
    }).toThrowError(FbCliError);

    expect(() => {
      resolveGraphPath({
        nodeType: "ad",
        id: "ad_1",
        edge: "unknown_edge",
      });
    }).toThrowError(/EDGE_NOT_SUPPORTED|not supported/);
  });

  it("blocks non-MVP edges", () => {
    expect(() => {
      resolveGraphPath({
        nodeType: "ad_account",
        id: "act_123",
        edge: "customaudiences",
      });
    }).toThrowError(/read-only MVP scope/);
  });

  it("blocks non-GET methods", () => {
    expect(() => {
      resolveGraphPath({
        nodeType: "campaign",
        id: "campaign_1",
        edge: "ads",
        method: "POST",
      });
    }).toThrowError(/read-only/);
  });
});
