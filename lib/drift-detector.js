'use strict';

const manifestManager = require('./manifest-manager');

async function detectDrift({ manifestPath, configPath, currentDirs }) {
  const manifest = await manifestManager.readManifest(manifestPath);
  if (!manifest) {
    return { noManifest: true, message: 'No manifest found - run baseline first' };
  }

  const drift = {
    hasDirectoryDrift: false,
    hasConfigDrift: false,
    hasTimeDrift: false,
    hasViolationDrift: false,
    addedDirs: [],
    removedDirs: [],
    age: 0,
    details: [],
  };

  const baselineDirs = manifest.directories_baselined || [];
  drift.addedDirs = currentDirs.filter((d) => !baselineDirs.includes(d));
  drift.removedDirs = baselineDirs.filter((d) => !currentDirs.includes(d));
  drift.hasDirectoryDrift = drift.addedDirs.length > 0 || drift.removedDirs.length > 0;

  if (drift.addedDirs.length > 0) {
    drift.details.push(`Added directories: ${drift.addedDirs.join(', ')}`);
  }
  if (drift.removedDirs.length > 0) {
    drift.details.push(`Removed directories: ${drift.removedDirs.join(', ')}`);
  }

  const currentHash = await manifestManager.hashFile(configPath);
  drift.hasConfigDrift = currentHash !== 'unknown' && currentHash !== manifest.config_hash;
  if (drift.hasConfigDrift) {
    drift.details.push('Configuration changed (config file hash mismatch)');
  }

  drift.age = manifestManager.calculateAge(manifest.created_at);
  drift.hasTimeDrift = drift.age > 30;
  if (drift.hasTimeDrift) {
    drift.details.push(`Baseline is ${drift.age} days old (consider refreshing)`);
  }

  return drift;
}

function formatDriftReport(drift) {
  if (drift.noManifest) {
    return drift.message;
  }

  const hasDrift = drift.hasDirectoryDrift || drift.hasConfigDrift || drift.hasTimeDrift;
  if (!hasDrift) {
    return null;
  }

  const lines = ['Drift Detected:'];
  for (const detail of drift.details) {
    lines.push(`  - ${detail}`);
  }
  return lines.join('\n');
}

async function autoHeal({ manifestPath, configPath, currentDirs, tool, version, currentViolations, testExcluded }) {
  const oldManifest = await manifestManager.readManifest(manifestPath);

  const newManifest = await manifestManager.createManifest({
    tool,
    version,
    directories: currentDirs,
    violations: currentViolations,
    configPath,
    testExcluded,
  });

  await manifestManager.writeManifest(manifestPath, newManifest);

  return {
    oldDirs: oldManifest ? oldManifest.directories_baselined : [],
    newDirs: currentDirs,
    oldViolations: oldManifest ? oldManifest.total_violations : 0,
    newViolations: currentViolations,
  };
}

module.exports = {
  detectDrift,
  formatDriftReport,
  autoHeal,
};
