'use strict';

const { execSync } = require('child_process');

// Resolve the BASE REF — the commit a breaking-change check diffs against.
//
// GIT IS THE SNAPSHOT
//
// The obvious design is to store a copy of each schema under .gtl/ at baseline time
// and diff against that. It is also wrong. `buf breaking --against '.git#branch=main'`
// and `git show main:schema.graphql` already work: git history IS an always-correct,
// always-present, zero-maintenance snapshot store.
//
// Building a second one inside a git repository would mean inventing a worse VCS in
// the corner of a working one, and inheriting a whole failure mode for nothing — the
// stored snapshot goes stale, or is regenerated wrong, or conflicts on merge, and
// then the breaking-change check is comparing today's schema against a fiction.
//
// A MISSING BASE REF IS A SKIP, NEVER A FAILURE
//
// The base ref is genuinely unavailable in ordinary, blameless situations: a shallow
// CI clone (`fetch-depth: 1`, the default), a detached HEAD, a fresh repo with one
// commit, a fork with no upstream. Failing there would mean the check goes red for
// reasons that have nothing to do with the code — and a check that cries wolf on
// clean code is a check people switch off.
//
// So: no base ref -> the adapter skips, loudly, and the push proceeds.

const CANDIDATES = ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master'];

function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Does this ref exist AND is it an ancestor we can actually diff against? */
function isUsable(ref, cwd) {
  const sha = git(`rev-parse --verify --quiet ${ref}^{commit}`, cwd);
  if (!sha) return false;

  // A shallow clone can name the ref while lacking the objects behind it. Reading a
  // tree from it is the cheapest way to find out whether the history is really there
  // — and finding out NOW, cheaply, beats a confusing failure inside the linter.
  return git(`rev-parse --verify --quiet ${ref}^{tree}`, cwd) !== null;
}

/**
 * The commit to diff against, or null if there isn't one we can trust.
 *
 * @param {string} projectRoot
 * @param {string} [configured] An explicit ref from the user's config, which always
 *   wins: trunk-based and release-branch repos disagree about what "the base" means,
 *   and we are not going to be right about that by guessing.
 * @returns {{ref: string, sha: string}|null}
 */
function resolveBaseRef(projectRoot, configured) {
  const cwd = projectRoot || process.cwd();

  if (configured) {
    // An explicitly configured ref that does not resolve is a CONFIG ERROR, not an
    // environment quirk — but it still must not block a push over something the
    // developer cannot fix from their laptop. Return null; the adapter skips and says
    // which ref it could not find.
    return isUsable(configured, cwd)
      ? { ref: configured, sha: git(`rev-parse ${configured}`, cwd) }
      : null;
  }

  // In a shallow clone HEAD~1 may not exist, so we never fall back to "the previous
  // commit" — diffing against a commit that happens to be the tip of your own feature
  // branch would compare your work against itself and find nothing, which is worse
  // than skipping because it looks like a pass.
  for (const ref of CANDIDATES) {
    if (isUsable(ref, cwd)) {
      return { ref, sha: git(`rev-parse ${ref}`, cwd) };
    }
  }

  return null;
}

/** Read a file's contents at a ref, or null if it did not exist there. */
function fileAtRef(projectRoot, ref, relPath) {
  return git(`show ${ref}:${relPath}`, projectRoot || process.cwd());
}

/** Is this repo a shallow clone? Used to explain a skip in terms a human can act on. */
function isShallow(projectRoot) {
  return git('rev-parse --is-shallow-repository', projectRoot || process.cwd()) === 'true';
}

/** A skip reason a human can actually do something about. */
function explainMissingBase(projectRoot, configured) {
  if (configured) {
    return (
      `the configured base ref "${configured}" does not exist here, so there is ` +
      'nothing to compare against'
    );
  }
  if (isShallow(projectRoot)) {
    return (
      'this is a shallow clone, so there is no history to compare against. In CI, ' +
      'set fetch-depth: 0 on actions/checkout'
    );
  }
  return (
    'no base branch found (looked for origin/HEAD, main, master), so there is ' +
    'nothing to compare against'
  );
}

module.exports = {
  resolveBaseRef,
  fileAtRef,
  isShallow,
  isUsable,
  explainMissingBase,
  CANDIDATES,
};
