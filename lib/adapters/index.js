'use strict';

const { LinterAdapter } = require('./adapter');
const EslintAdapter = require('./eslint');
const BiomeAdapter = require('./biome');
const RuffAdapter = require('./ruff');
const GolangciLintAdapter = require('./golangci-lint');
const ClippyAdapter = require('./clippy');
const TflintAdapter = require('./tflint');
const AnsibleLintAdapter = require('./ansible');
const ContractAdapter = require('./contract');
const OpenApiAdapter = require('./openapi');
const AlembicCheckAdapter = require('./alembic-check');
const SquawkAdapter = require('./squawk');
const { BufAdapter, BufBreakingAdapter } = require('./buf');
const SpectralAdapter = require('./spectral');

// The adapter registry. `tool` strings in gimme-the-lint.config.js resolve to
// concrete adapters here. Adding a language to gimme-the-lint means adding one
// entry to this map — nothing else in the engine needs to change.

const REGISTRY = {
  eslint: EslintAdapter,
  biome: BiomeAdapter,
  ruff: RuffAdapter,
  'golangci-lint': GolangciLintAdapter,
  clippy: ClippyAdapter,
  tflint: TflintAdapter,
  'ansible-lint': AnsibleLintAdapter,
  // The only adapters whose linter we ship ourselves (python/). Nothing else about
  // them is special: same contract, same registry, same idempotent-skip behavior.
  //
  // Two entries over one binary, deliberately. They answer different questions and
  // baseline independently: a team may carry model/schema debt for a quarter while
  // accepting ZERO drift between their API and its published contract.
  contract: ContractAdapter,
  openapi: OpenApiAdapter,
  // EXTERNAL tier: needs a live database, so it is structurally unreachable from
  // `check` (a git hook) and runs only from `verify`, in CI, where credentials live.
  'alembic-check': AlembicCheckAdapter,
  // Migration SAFETY: which operations take a table-locking hold on production.
  // Nothing about the SQL is malformed, so a syntax linter has nothing to say.
  squawk: SquawkAdapter,

  // Schema-FIRST languages: the file on disk IS the contract, and the code is
  // generated from it. Nothing to materialize, and nothing of ours to overwrite.
  //
  // buf and buf-breaking are two entries over ONE binary, deliberately: a team will
  // reasonably carry lint debt in a large proto tree for a quarter while accepting
  // exactly ZERO breaking changes. Fold them together and the only way to grandfather
  // the lint debt is to grandfather the breakage too.
  buf: BufAdapter,
  'buf-breaking': BufBreakingAdapter,
  spectral: SpectralAdapter,
};

/** Construct an adapter instance by id. Throws on an unknown id. */
function getAdapter(id, opts = {}) {
  const Ctor = REGISTRY[id];
  if (!Ctor) {
    throw new Error(
      `Unknown linter adapter: "${id}". Known adapters: ${listAdapters().join(', ')}`
    );
  }
  return new Ctor(opts);
}

/** Is `id` a registered adapter? */
function hasAdapter(id) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

/** All registered adapter ids. */
function listAdapters() {
  return Object.keys(REGISTRY);
}

/** Adapter instances that handle a given language (e.g. "python"). */
function adaptersForLanguage(language, opts = {}) {
  return listAdapters()
    .map((id) => getAdapter(id, opts))
    .filter((adapter) => adapter.languages.includes(language));
}

/** Register a custom adapter (used by tests and future extensions). */
function registerAdapter(id, Ctor) {
  if (typeof Ctor !== 'function') {
    throw new Error(`registerAdapter: "${id}" must be a constructor`);
  }
  REGISTRY[id] = Ctor;
}

module.exports = {
  LinterAdapter,
  getAdapter,
  hasAdapter,
  listAdapters,
  adaptersForLanguage,
  registerAdapter,
};
