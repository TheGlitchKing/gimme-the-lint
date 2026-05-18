'use strict';

// Per-linter rule-alias maps for rule-rename / rule-removal migration.
//
// fingerprint() folds ruleId into a violation's identity (deliberately — two
// different rules on the same line are distinct problems). So when an upstream
// linter RENAMES a rule, the baselined fingerprint is orphaned and the renamed
// rule blocks as a "new" violation; when a linter REMOVES a rule, a stale
// baseline entry lingers and inflates `total`.
//
// `gimme-the-lint migrate --rules` re-lints each unit and uses these maps to
// rewrite a renamed rule's stored fingerprint old→new (preserving the
// grandfather) and to drop entries for rules that no longer occur.
//
//   oldRuleId: 'newRuleId'   — the rule was renamed
//   oldRuleId: null          — the rule was removed
//
// These are DATA, not code — extend a map as an upstream linter changes its
// rule ids. Every map is empty by default: nothing is migrated until an entry
// exists, so the mechanism is inert until a real rename is recorded.

const RULE_ALIASES = {
  eslint: {},
  biome: {},
  ruff: {},
  'golangci-lint': {},
  clippy: {},
  tflint: {},
  'ansible-lint': {},
};

/** The alias map for a linter ({} when the linter has none). */
function getAliases(linterId) {
  return RULE_ALIASES[linterId] || {};
}

/** Register or extend a linter's alias map (used by updates and tests). */
function registerAliases(linterId, aliases) {
  RULE_ALIASES[linterId] = { ...(RULE_ALIASES[linterId] || {}), ...aliases };
}

module.exports = { RULE_ALIASES, getAliases, registerAliases };
