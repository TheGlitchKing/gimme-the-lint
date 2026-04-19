#!/usr/bin/env node
import { runSessionStart } from "@theglitchking/claude-plugin-runtime";

await runSessionStart({
  packageName: "@theglitchking/gimme-the-lint",
  pluginName: "gimme-the-lint",
  configFile: "gimme-the-lint.json",
});
