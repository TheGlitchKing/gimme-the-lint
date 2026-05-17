'use strict';

const { LinterAdapter } = require('./adapter');
const EslintAdapter = require('./eslint');
const RuffAdapter = require('./ruff');
const GolangciLintAdapter = require('./golangci-lint');
const ClippyAdapter = require('./clippy');

// The adapter registry. `tool` strings in gimme-the-lint.config.js resolve to
// concrete adapters here. Adding a language to gimme-the-lint means adding one
// entry to this map — nothing else in the engine needs to change.

const REGISTRY = {
  eslint: EslintAdapter,
  ruff: RuffAdapter,
  'golangci-lint': GolangciLintAdapter,
  clippy: ClippyAdapter,
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
