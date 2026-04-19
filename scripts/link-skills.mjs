#!/usr/bin/env node
// Postinstall — delegates to @theglitchking/claude-plugin-runtime.

import { runPostinstall } from "@theglitchking/claude-plugin-runtime";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  runPostinstall({
    packageName: "@theglitchking/gimme-the-lint",
    pluginName: "gimme-the-lint",
    configFile: "gimme-the-lint.json",
    skillsDir: null,
    packageRoot,
    hookCommand:
      "node ./node_modules/@theglitchking/gimme-the-lint/hooks/session-start.mjs",
  });
} catch (err) {
  console.warn(`[gimme-the-lint] postinstall failed: ${err?.message || err}`);
}
