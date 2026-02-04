'use strict';

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

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
  if (!hooksDir) return { gitRepo: false, hooks: {} };

  const hooks = ['pre-commit', 'pre-push'];
  const status = {};

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook);
    if (await fs.pathExists(hookPath)) {
      const content = await fs.readFile(hookPath, 'utf8');
      status[hook] = content.includes('gimme-the-lint') ? 'installed' : 'other';
    } else {
      status[hook] = 'missing';
    }
  }

  return { gitRepo: true, hooks: status };
}

module.exports = {
  getGitRoot,
  getHooksDir,
  installHooks,
  uninstallHooks,
  getStatus,
};
