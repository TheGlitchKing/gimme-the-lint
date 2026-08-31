'use strict';

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// The hook CONTRACT version — bumped whenever the flags a hook passes to the CLI
// change. It is NOT the package version; a release that does not touch the hooks
// does not bump it.
//
// This exists because git hooks are installed FILES living in .git/hooks. `npm
// update` rewrites lib/, but it cannot rewrite a hook a user installed months ago.
// So an upgraded engine can find itself driven by a hook that predates it and
// passes none of the flags it now expects — and the new checks then silently never
// run. The user gets a green hook, believes they are guarded, and is not. That is
// the exact "guard that reports green" failure this engine exists to eliminate, so
// it must not be how the engine itself ships.
//
// Detection is by marker, not by guessing: every hook we install carries a
// `gtl-hook-contract: N` comment, and `status` compares N against this constant.
const HOOK_CONTRACT_VERSION = 2;

const CONTRACT_RE = /gtl-hook-contract:\s*(\d+)/;

/** The contract version declared by an installed hook (0 = pre-versioning). */
function hookContractVersion(content) {
  const match = CONTRACT_RE.exec(content || '');
  return match ? Number(match[1]) : 0;
}

function getGitRoot(projectRoot) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/** Where git *would* look if core.hooksPath were unset. Only used to spot orphans. */
function defaultHooksDir(projectRoot) {
  const gitRoot = getGitRoot(projectRoot);
  return gitRoot ? path.join(gitRoot, '.git', 'hooks') : null;
}

// Ask git where the hooks live; never assume. `--git-path hooks` honors
// core.hooksPath AND worktrees, both of which put the hooks somewhere other than
// <root>/.git/hooks. Assuming was the whole of #13: we wrote hooks git would never
// execute, then read the same wrong directory back and reported "installed" — a
// green tick over zero guard, which is the exact failure this engine exists to
// eliminate.
function getHooksDir(projectRoot) {
  try {
    const out = execSync('git rev-parse --git-path hooks', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    // git prints it relative to cwd (or absolute when core.hooksPath is absolute).
    if (out) return path.resolve(projectRoot, out);
  } catch {
    // Not a repo, or a git too old for --git-path (< 2.5). Degrade to the old
    // behavior rather than losing hook support entirely.
  }
  return defaultHooksDir(projectRoot);
}

/**
 * The snippet for repos that already own their hook files. Composition, not
 * ownership: a shared .githooks/pre-push that also regenerates a project map and
 * scans for secrets is not ours to overwrite.
 *
 * It carries the same `gtl-hook-contract` marker the installed hooks carry, so
 * `status` reports an embedded block as stale on the same terms.
 */
function hookSnippet(hook) {
  const flags = hook === 'pre-push' ? '--all --stage=push' : '--stage=commit';
  return `# --- gimme-the-lint (gtl-hook-contract: ${HOOK_CONTRACT_VERSION}) ---
# Refresh with: gimme-the-lint hooks --print ${hook}
GTL="$(git rev-parse --show-toplevel)/node_modules/.bin/gimme-the-lint"
[ -x "$GTL" ] || GTL="$(command -v gimme-the-lint || true)"
if [ -x "$GTL" ]; then
    "$GTL" check ${flags} || exit 1
else
    echo "gimme-the-lint: not installed, skipping"
fi
# --- end gimme-the-lint ---
`;
}

// Thrown, rather than clobbering, when the hooks directory already holds hooks
// that are not ours. Under core.hooksPath that directory is INSIDE the working
// tree and usually version-controlled, so "back it up and overwrite" means
// rewriting a file the whole team shares. `.conflicts` names them so the CLI can
// point at `hooks --print`.
class ForeignHookError extends Error {
  constructor(conflicts, hooksDir) {
    super(
      `Refusing to overwrite hooks this tool did not write: ${conflicts.join(', ')} in ${hooksDir}`
    );
    this.name = 'ForeignHookError';
    this.conflicts = conflicts;
    this.hooksDir = hooksDir;
  }
}

async function installHooks(projectRoot, opts = {}) {
  const hooksDir = getHooksDir(projectRoot);
  if (!hooksDir) {
    throw new Error('Not a git repository. Run git init first.');
  }

  const sourceHooksDir = path.join(__dirname, '..', 'githooks');
  const hooks = ['pre-commit', 'pre-push'];

  // Look before writing anything: an install that clobbers one hook and then
  // refuses on the next leaves the repo half-owned.
  const conflicts = [];
  for (const hook of hooks) {
    if (!(await fs.pathExists(path.join(sourceHooksDir, hook)))) continue;
    const dest = path.join(hooksDir, hook);
    if (!(await fs.pathExists(dest))) continue;
    const existing = await fs.readFile(dest, 'utf8');
    if (!existing.includes('gimme-the-lint')) conflicts.push(hook);
  }
  if (conflicts.length && !opts.force) {
    throw new ForeignHookError(conflicts, hooksDir);
  }

  await fs.ensureDir(hooksDir);
  const installed = [];

  for (const hook of hooks) {
    const src = path.join(sourceHooksDir, hook);
    const dest = path.join(hooksDir, hook);

    if (!await fs.pathExists(src)) continue;

    if (conflicts.includes(hook)) {
      const backup = `${dest}.backup.${Date.now()}`;
      await fs.copy(dest, backup);
    }

    await fs.copy(src, dest);
    await fs.chmod(dest, 0o755);
    installed.push(hook);
  }

  return installed;
}

async function uninstallHooks(projectRoot) {
  const hooksDir = getHooksDir(projectRoot);
  if (!hooksDir) return [];

  const hooks = ['pre-commit', 'pre-push'];
  const removed = [];

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook);
    if (await fs.pathExists(hookPath)) {
      const content = await fs.readFile(hookPath, 'utf8');
      if (content.includes('gimme-the-lint')) {
        await fs.remove(hookPath);

        // Restore backup if exists
        const backups = (await fs.readdir(hooksDir))
          .filter((f) => f.startsWith(`${hook}.backup.`))
          .sort()
          .reverse();
        if (backups.length > 0) {
          await fs.move(path.join(hooksDir, backups[0]), hookPath);
        }

        removed.push(hook);
      }
    }
  }

  return removed;
}

async function getStatus(projectRoot) {
  const hooksDir = getHooksDir(projectRoot);
  if (!hooksDir) {
    return { gitRepo: false, hooks: {}, stale: [], hooksDir: null, orphaned: [] };
  }

  const hooks = ['pre-commit', 'pre-push'];
  const status = {};
  const stale = [];

  // Hooks of ours sitting in .git/hooks while git is reading somewhere else.
  // Every version before this fix installed there unconditionally, so a
  // core.hooksPath repo that ran `hooks` has a full set of files git has never
  // once executed. They must be named, not left to look like an install.
  const orphaned = [];
  const fallback = defaultHooksDir(projectRoot);
  if (fallback && path.resolve(fallback) !== path.resolve(hooksDir)) {
    for (const hook of hooks) {
      const p = path.join(fallback, hook);
      if (!(await fs.pathExists(p))) continue;
      if ((await fs.readFile(p, 'utf8')).includes('gimme-the-lint')) orphaned.push(hook);
    }
  }

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook);
    if (!(await fs.pathExists(hookPath))) {
      status[hook] = 'missing';
      continue;
    }
    const content = await fs.readFile(hookPath, 'utf8');
    if (!content.includes('gimme-the-lint')) {
      status[hook] = 'other';
      continue;
    }
    // Ours — but is it OUR VINTAGE? An old hook still exits 0 and still looks
    // installed; it just quietly does less than the engine now expects.
    if (hookContractVersion(content) < HOOK_CONTRACT_VERSION) {
      status[hook] = 'stale';
      stale.push(hook);
    } else {
      status[hook] = 'installed';
    }
  }

  return { gitRepo: true, hooks: status, stale, hooksDir, orphaned };
}

module.exports = {
  getGitRoot,
  getHooksDir,
  defaultHooksDir,
  hookSnippet,
  ForeignHookError,
  installHooks,
  uninstallHooks,
  getStatus,
  hookContractVersion,
  HOOK_CONTRACT_VERSION,
};
