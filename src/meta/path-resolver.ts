import { FbCliError } from "../errors/fbcli-error.js";
import {
  GRAPH_RESOURCES,
  type GraphEdgeDefinition,
  type GraphNodeDefinition,
  type GraphNodeType,
  normalizeGraphId,
} from "../schema/graph-resources.js";

export type ResolvePathInput = {
  nodeType: GraphNodeType;
  id: string;
  edge?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

export type ResolvedGraphPath = {
  path: string;
  node: GraphNodeDefinition;
  edge?: GraphEdgeDefinition;
};

export function resolveGraphPath(input: ResolvePathInput): ResolvedGraphPath {
  const method = input.method ?? "GET";
  const node = GRAPH_RESOURCES[input.nodeType];
  const normalizedId = normalizeGraphId(input.id);

  if (input.nodeType === "ad_account" && !normalizedId.startsWith("act_")) {
    throw new FbCliError("INVALID_GRAPH_ID", "Ad account IDs must start with act_", {
      id: input.id,
    });
  }

  const rootPath = `/${normalizedId}`;

  if (!input.edge) {
    if (method !== "GET") {
      throw new FbCliError("UNSUPPORTED_IN_MVP", "MVP only supports GET operations.", {
        nodeType: input.nodeType,
        method,
      });
    }

    return {
      path: rootPath,
      node,
    };
  }

  const edge = node.edges[input.edge];
  if (!edge) {
    throw new FbCliError(
      "EDGE_NOT_SUPPORTED",
      `Edge ${input.edge} is not supported for node type ${input.nodeType}`,
      {
        nodeType: input.nodeType,
        edge: input.edge,
        supportedEdges: Object.keys(node.edges),
      },
    );
  }

  if (method !== "GET") {
    throw new FbCliError("UNSUPPORTED_IN_MVP", "MVP is read-only and only supports GET operations.", {
      nodeType: input.nodeType,
      edge: input.edge,
      method,
    });
  }

  if (!edge.read || !edge.mvpReadAllowed) {
    throw new FbCliError(
      "UNSUPPORTED_IN_MVP",
      `Edge ${input.edge} exists but is disabled in read-only MVP scope.`,
      {
        nodeType: input.nodeType,
        edge: input.edge,
      },
    );
  }

  return {
    path: `${rootPath}/${input.edge}`,
    node,
    edge,
  };
}
