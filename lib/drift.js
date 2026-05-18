'use strict';

const path = require('path');
const gtlManifest = require('./gtl-manifest');
const { resolveUnits } = require('./units');
const adapters = require('./adapters');
const { configHashFor } = require('./baseline');

// Drift detection, v2: keyed per app. A config or linter-version change in one
// app produces drift for THAT app only — it never churns unrelated baselines.
// Four drift kinds are surfaced:
//   - app added / removed since the last baseline
//   - per-app/per-linter config-file hash changed
//   - per-app/per-linter linter version changed
//   - the baseline is older than TIME_DRIFT_DAYS

const TIME_DRIFT_DAYS = 30;

/** Compare the current project state against the recorded global manifest. */
async function detectDrift(projectRoot) {
  const root = projectRoot || process.cwd();
  const manifest = await gtlManifest.readManifest(root);
  if (!manifest) {
    return { noManifest: true, hasDrift: false };
  }

  // Resolve apps the same way baseline does, so explicit config and
  // auto-detection agree on what "the apps" are.
  const currentApps = resolveUnits(root).map((u) => ({
    appPath: u.appPath,
    linters: u.linters,
  }));
  const currentPaths = new Set(currentApps.map((a) => a.appPath));
  const manifestPaths = new Set(Object.keys(manifest.apps || {}));

  const addedApps = [...currentPaths].filter((p) => !manifestPaths.has(p)).sort();
  const removedApps = [...manifestPaths].filter((p) => !currentPaths.has(p)).sort();

  const ageDays = Math.floor(
    (Date.now() - new Date(manifest.updated_at).getTime()) / 86400000
  );

  const linterDrift = [];
  for (const app of currentApps) {
    const recorded = manifest.apps[app.appPath];
    if (!recorded) continue; // already counted as an added app
    for (const linterId of app.linters) {
      let adapter;
      try {
        adapter = adapters.getAdapter(linterId, {
          projectRoot: root,
          appRoot: path.resolve(root, app.appPath),
        });
      } catch {
        continue;
      }
      const rec = (recorded.linters || {})[linterId];
      if (!rec) {
        linterDrift.push({ app: app.appPath, linter: linterId, type: 'new-linter' });
        continue;
      }

      // Config drift — the linter's config file hash changed.
      const appRoot = path.resolve(root, app.appPath);
      const currentHash = await configHashFor(root, appRoot, adapter);
      if (
        rec.config_hash &&
        rec.config_hash !== 'unknown' &&
        currentHash !== 'unknown' &&
        currentHash !== rec.config_hash
      ) {
        linterDrift.push({ app: app.appPath, linter: linterId, type: 'config' });
      }

      // Version drift — the linter binary version changed.
      if (adapter.available()) {
        const currentVersion = adapter.version();
        if (
          rec.tool_version &&
          rec.tool_version !== 'unknown' &&
          currentVersion !== 'unknown' &&
          currentVersion !== rec.tool_version
        ) {
          linterDrift.push({
            app: app.appPath,
            linter: linterId,
            type: 'version',
            from: rec.tool_version,
            to: currentVersion,
          });
        }

        // Ruleset-plugin drift — a plugin updated (e.g. `tflint --init` pulled
        // a newer ruleset under a loose version constraint) without the config
        // file text or the binary version changing. Generic over plugin names.
        if (
          typeof adapter.rulesetVersions === 'function' &&
          rec.ruleset_versions
        ) {
          const current = adapter.rulesetVersions();
          const names = new Set([
            ...Object.keys(rec.ruleset_versions),
            ...Object.keys(current),
          ]);
          for (const name of names) {
            const from = rec.ruleset_versions[name];
            const to = current[name];
            if (from !== to) {
              linterDrift.push({
                app: app.appPath,
                linter: linterId,
                type: 'ruleset',
                ruleset: name,
                from: from || 'absent',
                to: to || 'absent',
              });
            }
          }
        }
      }
    }
  }

  const hasTimeDrift = ageDays > TIME_DRIFT_DAYS;
  const hasDrift =
    addedApps.length > 0 ||
    removedApps.length > 0 ||
    linterDrift.length > 0 ||
    hasTimeDrift;

  return {
    noManifest: false,
    hasDrift,
    addedApps,
    removedApps,
    linterDrift,
    ageDays,
    hasTimeDrift,
  };
}

/** Render a drift result, or null when there is no drift. */
function formatDriftReport(drift) {
  if (drift.noManifest) {
    return 'No baseline manifest — run: gimme-the-lint baseline';
  }
  if (!drift.hasDrift) return null;

  const lines = ['Drift detected:'];
  for (const app of drift.addedApps) lines.push(`  + new app: ${app}`);
  for (const app of drift.removedApps) lines.push(`  - removed app: ${app}`);
  for (const d of drift.linterDrift) {
    if (d.type === 'config') {
      lines.push(`  ~ ${d.app} · ${d.linter}: config changed`);
    } else if (d.type === 'version') {
      lines.push(`  ~ ${d.app} · ${d.linter}: ${d.from} → ${d.to}`);
    } else if (d.type === 'ruleset') {
      lines.push(
        `  ~ ${d.app} · ${d.linter}: ruleset ${d.ruleset} ${d.from} → ${d.to}`
      );
    } else if (d.type === 'new-linter') {
      lines.push(`  + ${d.app}: new linter ${d.linter}`);
    }
  }
  if (drift.hasTimeDrift) {
    lines.push(`  ! baseline is ${drift.ageDays} days old (consider refreshing)`);
  }
  return lines.join('\n');
}

module.exports = {
  detectDrift,
  formatDriftReport,
  TIME_DRIFT_DAYS,
};
