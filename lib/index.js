'use strict';

const directoryDiscovery = require('./directory-discovery');
const manifestManager = require('./manifest-manager');
const driftDetector = require('./drift-detector');
const venvManager = require('./venv-manager');
const configManager = require('./config-manager');
const gitHooksManager = require('./git-hooks-manager');
const installer = require('./installer');
const violation = require('./violation');
const fingerprint = require('./fingerprint');
const diffEngine = require('./diff-engine');
const baselineStore = require('./baseline-store');
const adapters = require('./adapters');
const units = require('./units');
const check = require('./check');
const baseline = require('./baseline');
const report = require('./report');

module.exports = {
  directoryDiscovery,
  manifestManager,
  driftDetector,
  venvManager,
  configManager,
  gitHooksManager,
  installer,
  // v2.0 progressive-lint engine
  violation,
  fingerprint,
  diffEngine,
  baselineStore,
  adapters,
  units,
  check,
  baseline,
  report,
};
