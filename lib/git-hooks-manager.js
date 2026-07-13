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

function getHooksDir(projectRoot) {
  const gitRoot = getGitRoot(projectRoot);
  if (!gitRoot) return null;
  return path.join(gitRoot, '.git', 'hooks');
}

async function installHooks(projectRoot) {
  const hooksDir = getHooksDir(projectRoot);
  if (!hooksDir) {
    throw new Error('Not a git repository. Run git init first.');
  }

  await fs.ensureDir(hooksDir);

  const sourceHooksDir = path.join(__dirname, '..', 'githooks');
  const hooks = ['pre-commit', 'pre-push'];
  const installed = [];

  for (const hook of hooks) {
    const src = path.join(sourceHooksDir, hook);
    const dest = path.join(hooksDir, hook);

    if (!await fs.pathExists(src)) continue;

    if (await fs.pathExists(dest)) {
      const existing = await fs.readFile(dest, 'utf8');
      if (!existing.includes('gimme-the-lint')) {
        const backup = `${dest}.backup.${Date.now()}`;
        await fs.copy(dest, backup);
      }
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
  if (!hooksDir) return { gitRepo: false, hooks: {}, stale: [] };

  const hooks = ['pre-commit', 'pre-push'];
  const status = {};
  const stale = [];

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

  return { gitRepo: true, hooks: status, stale };
}

module.exports = {
  getGitRoot,
  getHooksDir,
  installHooks,
  uninstallHooks,
  getStatus,
  hookContractVersion,
  HOOK_CONTRACT_VERSION,
};
