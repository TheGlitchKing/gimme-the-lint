'use strict';

const { fingerprint } = require('./fingerprint');

// The diff engine answers the only question progressive linting cares about:
// "is this violation NEW, or was it already in the baseline?"
//
// A baseline is a {fingerprint: count} map. A violation is new iff the current
// occurrence count for its fingerprint exceeds the baselined count. Counting
// (rather than a plain set) means adding a second identical violation to a
// file is still caught, even though one copy was already grandfathered.
//
// This module is pure: no I/O, no global state. Everything it needs is passed in.

/**
 * Coerce any accepted baseline representation into a Map<fingerprint, count>.
 * Accepts: a Map, a linter section ({fingerprints: {...}}), a raw {fp: count}
 * object, or null/undefined (treated as an empty baseline).
 */
function toCountMap(baseline) {
  if (!baseline) return new Map();
  if (baseline instanceof Map) return new Map(baseline);
  if (baseline.fingerprints && typeof baseline.fingerprints === 'object') {
    return new Map(Object.entries(baseline.fingerprints));
  }
  if (typeof baseline === 'object') {
    return new Map(Object.entries(baseline));
  }
  return new Map();
}

/** Count current violations by fingerprint → Map<fingerprint, count>. */
function countByFingerprint(violations) {
  const counts = new Map();
  for (const v of violations || []) {
    const fp = fingerprint(v);
    counts.set(fp, (counts.get(fp) || 0) + 1);
  }
  return counts;
}

/**
 * Diff current violations against a baseline.
 * @param {object[]} current  NormalizedViolation[] from the current lint run.
 * @param {Map|object} baseline  Baseline fingerprint counts (see toCountMap).
 * @returns {{new: object[], baselined: object[], fixed: object[], summary: object}}
 *   new       - violations that exceed the baselined count (these block)
 *   baselined - violations covered by the baseline (grandfathered, allowed)
 *   fixed     - {fingerprint, count} entries present in the baseline but no
 *               longer occurring as often; surfacing these lets baselines heal
 */
function diff(current, baseline) {
  const baselineCounts = toCountMap(baseline);
  const currentList = current || [];

  // Group current violations by fingerprint, preserving the violation objects
  // so callers get back real violations to report on.
  const byFingerprint = new Map();
  for (const v of currentList) {
    const fp = fingerprint(v);
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
    byFingerprint.get(fp).push(v);
  }

  const newViolations = [];
  const baselinedViolations = [];

  for (const [fp, violations] of byFingerprint) {
    const allowed = Number(baselineCounts.get(fp)) || 0;
    violations.forEach((v, index) => {
      if (index < allowed) baselinedViolations.push(v);
      else newViolations.push(v);
    });
  }

  // Anything baselined that occurs fewer times now has been (partially) fixed.
  const fixed = [];
  for (const [fp, baselinedCount] of baselineCounts) {
    const group = byFingerprint.get(fp);
    const currentCount = group ? group.length : 0;
    if (currentCount < Number(baselinedCount)) {
      fixed.push({ fingerprint: fp, count: Number(baselinedCount) - currentCount });
    }
  }

  return {
    new: newViolations,
    baselined: baselinedViolations,
    fixed,
    summary: {
      total: currentList.length,
      new: newViolations.length,
      baselined: baselinedViolations.length,
      fixed: fixed.reduce((sum, f) => sum + f.count, 0),
    },
  };
}

/** Convenience predicate: did the diff surface anything that should block? */
function hasNewViolations(diffResult) {
  return Boolean(diffResult && diffResult.new && diffResult.new.length > 0);
}

module.exports = {
  diff,
  hasNewViolations,
  countByFingerprint,
  toCountMap,
};
