'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');

// Retained from v1 for hashFile() ONLY — its live consumer is baseline.js,
// which hashes each linter's config file to detect config drift. The v1
// manifest functions (createManifest / readManifest / writeManifest /
// calculateAge) were removed in the v2.3.0 tflint audit: the v2 global
// manifest is owned by gtl-manifest.js and drift by drift.js, which supersede
// the old single-file `.baseline-manifest.json` model entirely.

/** md5 of a file's contents, or "unknown" when the file is absent. */
async function hashFile(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return 'unknown';
  }
  const content = await fs.readFile(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
}

module.exports = { hashFile };
