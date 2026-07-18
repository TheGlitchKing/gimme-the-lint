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
const CodegenDriftAdapter = require('./codegen-drift');
const AlembicCheckAdapter = require('./alembic-check');
const SquawkAdapter = require('./squawk');
const { BufAdapter, BufBreakingAdapter } = require('./buf');
const SpectralAdapter = require('./spectral');
const TscAdapter = require('./tsc');
const MypyAdapter = require('./mypy');

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
  // ORDER MATTERS, and it is the entire chaining mechanism.
  //
  // `materialize` walks this registry in order: `openapi` writes the lockfile, and THEN
  // codegen-drift generates from the file that was just written. Put codegen first and it
  // would generate from yesterday's lockfile and confidently report success.
  //
  // Nothing else couples them. codegen-drift compares the COMMITTED lockfile against the
  // COMMITTED types, so a stale lockfile with matching types is correctly green — the
  // types faithfully describe the lockfile, and `lockfile-stale` already names the real
  // problem. One root cause, one finding.
  'codegen-drift': CodegenDriftAdapter,
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

  // WHOLE-PROGRAM type checkers. Bound alongside eslint/ruff, never instead of
  // them — the same argument as contract-alongside-ruff: "is this code well-formed?"
  // and "do these types actually line up?" are different questions with different
  // debt, and folding them together means the only way to grandfather one is to
  // grandfather the other.
  //
  // Unlike every adapter above, these two IGNORE the file list they are handed and
  // always check the entire program. That is not an optimization to fix later; it is
  // what makes them correct. See the header of tsc.js.
  tsc: TscAdapter,
  mypy: MypyAdapter,
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

/**
 * Order adapter ids the way `materialize` must run them: registry order, not
 * alphabetical.
 *
 * This is load-bearing and it is not obvious. A unit's `linters` array is SORTED —
 * `project-model.js` sorts it, and a user's explicit `apps` config lists them in whatever
 * order they typed. Alphabetically, `codegen-drift` comes before `openapi`.
 *
 * Run them in that order and `materialize` generates the client types from YESTERDAY'S
 * lockfile, then overwrites the lockfile, and reports success. The types would be stale
 * the instant they were written, and the command whose entire job is to make them fresh
 * would be the thing that staled them.
 *
 * Registry order encodes the derivation chain: lockfile first, then everything derived
 * from it.
 */
function materializeOrder(ids) {
  const order = listAdapters();
  return [...(ids || [])].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
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
  materializeOrder,
  adaptersForLanguage,
  registerAdapter,
};
