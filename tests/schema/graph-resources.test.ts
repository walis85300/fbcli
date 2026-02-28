import { describe, expect, it } from "vitest";
import {
  GRAPH_RESOURCES,
  inferGraphNodeTypeFromId,
  listGraphEdges,
  listGraphNodes,
  parseGraphNodeType,
} from "../../src/schema/graph-resources.js";

describe("graph resource schema", () => {
  it("lists all supported root nodes", () => {
    const types = listGraphNodes().map((node) => node.type);

    expect(types).toEqual(["user", "ad_account", "campaign", "adset", "ad", "creative"]);
  });

  it("contains expected read-only MVP edges for ad account", () => {
    const edges = listGraphEdges("ad_account").map((edge) => edge.name);

    expect(edges).toContain("insights");
    expect(edges).toContain("ads");
    expect(edges).toContain("customaudiences");
  });

  it("marks customaudiences as disabled for read-only MVP", () => {
    expect(GRAPH_RESOURCES.ad_account.edges.customaudiences.mvpReadAllowed).toBe(false);
  });

  it("parses node aliases", () => {
    expect(parseGraphNodeType("account")).toBe("ad_account");
    expect(parseGraphNodeType("adcreative")).toBe("creative");
  });

  it("infers node type from prefixed IDs", () => {
    expect(inferGraphNodeTypeFromId("act_1")).toBe("ad_account");
    expect(inferGraphNodeTypeFromId("campaign_1")).toBe("campaign");
    expect(inferGraphNodeTypeFromId("adset_1")).toBe("adset");
    expect(inferGraphNodeTypeFromId("ad_1")).toBe("ad");
    expect(inferGraphNodeTypeFromId("creative_1")).toBe("creative");
    expect(inferGraphNodeTypeFromId("user_1")).toBe("user");
  });
});
