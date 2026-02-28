import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifestV1 } from "../../src/agent/manifest.js";

function readJsonFile<T>(relativePathFromThisFile: string): T {
  const fileUrl = new URL(relativePathFromThisFile, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as T;
}

function assertManifestConformsSchema(manifest: Record<string, unknown>, schema: Record<string, unknown>): void {
  const required = (schema.required as string[]) ?? [];
  for (const requiredKey of required) {
    expect(manifest).toHaveProperty(requiredKey);
  }

  expect(typeof manifest.manifest_version).toBe("string");
  expect(manifest.cli).toMatchObject({ name: "fbcli" });
  expect(manifest.stability).toHaveProperty("contract", "stable");
  expect(Array.isArray(manifest.errors)).toBe(true);
  expect(Array.isArray(manifest.commands)).toBe(true);
  expect(Array.isArray(manifest.recipes)).toBe(true);

  const commands = manifest.commands as Array<Record<string, unknown>>;
  for (const command of commands) {
    expect(typeof command.id).toBe("string");
    expect(Array.isArray(command.path)).toBe(true);
    expect(Array.isArray(command.options)).toBe(true);
    expect(Array.isArray(command.arguments)).toBe(true);
    expect(command.output_contract).toBeTruthy();
    expect(Array.isArray(command.examples)).toBe(true);
  }

  const recipes = manifest.recipes as Array<Record<string, unknown>>;
  for (const recipe of recipes) {
    expect(typeof recipe.id).toBe("string");
    expect(Array.isArray(recipe.references)).toBe(true);
    expect(Array.isArray(recipe.steps)).toBe(true);
  }
}

describe("agent manifest", () => {
  it("builds a deterministic, versioned manifest", () => {
    const manifest = buildManifestV1();

    expect(manifest.manifest_version).toBe("1.0.0");
    expect(manifest.cli.name).toBe("fbcli");
    expect(manifest.stability.contract).toBe("stable");
  });

  it("has unique, stable command ids", () => {
    const manifest = buildManifestV1();
    const ids = manifest.commands.map((command) => command.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("report.creative-deep-dive");
    expect(ids).toContain("insights.query");
  });

  it("includes required flags on key commands", () => {
    const manifest = buildManifestV1();
    const insightsQuery = manifest.commands.find((command) => command.id === "insights.query");
    const creativeReport = manifest.commands.find((command) => command.id === "report.creative-deep-dive");

    expect(insightsQuery).toBeTruthy();
    expect(creativeReport).toBeTruthy();

    const insightsOptionNames = (insightsQuery?.options ?? []).map((option) => option.name);
    const creativeOptionNames = (creativeReport?.options ?? []).map((option) => option.name);

    expect(insightsOptionNames).toContain("--node");
    expect(creativeOptionNames).toContain("--account");
    expect(creativeOptionNames).toContain("--totals-only");
  });

  it("documents totals-only output contract notes", () => {
    const manifest = buildManifestV1();
    const creativeReport = manifest.commands.find((command) => command.id === "report.creative-deep-dive");

    expect(creativeReport).toBeTruthy();
    expect(creativeReport?.output_contract.conditional_notes.join(" ")).toContain("--totals-only");
  });

  it("conforms to the v1 schema artifact", () => {
    const manifest = buildManifestV1() as unknown as Record<string, unknown>;
    const schema = readJsonFile<Record<string, unknown>>("../../schemas/fbcli-manifest.schema.v1.json");

    assertManifestConformsSchema(manifest, schema);
  });

  it("matches committed v1 snapshot artifact", () => {
    const manifest = buildManifestV1();
    const snapshot = readJsonFile<typeof manifest>("../../schemas/fbcli-manifest.v1.json");

    expect(manifest).toEqual(snapshot);
  });
});

