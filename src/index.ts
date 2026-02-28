#!/usr/bin/env node

import { runCli } from "./cli/app.js";
import { GraphApiClient } from "./meta/client.js";
import { resolveAccessTokenForCli } from "./auth-workflow.js";

function handleBrokenPipe(error: NodeJS.ErrnoException): void {
  if (error.code === "EPIPE") {
    process.exit(0);
  }

  throw error;
}

process.stdout.on("error", handleBrokenPipe);
process.stderr.on("error", handleBrokenPipe);

const client = new GraphApiClient({
  accessToken: resolveAccessTokenForCli().accessToken,
  apiVersion: process.env.FBCLI_API_VERSION,
});

const result = await runCli(process.argv.slice(2), client);
process.exitCode = result.exitCode;
