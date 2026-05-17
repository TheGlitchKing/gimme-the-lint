'use strict';

const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// ansible-lint adapter. ansible-lint is the de-facto linter for Ansible
// playbooks, roles and collections; `-f codeclimate` emits a machine-readable
// JSON report. Ansible has no manifest file and playbooks are plain YAML, so
// detection keys off the unambiguous Ansible markers `ansible.cfg` and
// `galaxy.yml` — a YAML extension scan would match virtually every repo.
// ansible-lint auto-discovers playbooks/roles from the directory it runs in.

const ANSIBLE_CONFIG_FILES = ['.ansible-lint', '.config/ansible-lint.yml'];

/** Map an ansible-lint (CodeClimate) severity onto a NormalizedViolation severity. */
function mapSeverity(severity) {
  switch (String(severity).toLowerCase()) {
    case 'info':
      return SEVERITY.INFO;
    case 'minor':
      return SEVERITY.WARNING;
    case 'major':
    case 'critical':
    case 'blocker':
      return SEVERITY.ERROR;
    default:
      return SEVERITY.WARNING;
  }
}

class AnsibleLintAdapter extends LinterAdapter {
  get id() {
    return 'ansible-lint';
  }

  get languages() {
    return ['ansible'];
  }

  get supportsFix() {
    return true;
  }

  get manifestFiles() {
    return ['ansible.cfg', 'galaxy.yml'];
  }

  // Ansible source is plain YAML — far too broad to scan by extension, so
  // detection is manifest-only (see manifestFiles).
  get sourceExtensions() {
    return [];
  }

  configFiles() {
    return ANSIBLE_CONFIG_FILES;
  }

  buildCommand(targets, opts = {}) {
    const args = ['-f', 'codeclimate'];
    if (opts.fix && this.supportsFix) args.push('--fix');
    const paths = targets && targets.length ? targets.slice() : ['.'];
    args.push(...paths);
    return { cmd: this.binary, args, cwd: opts.cwd || this.projectRoot };
  }

  parse(stdout) {
    const text = (stdout || '').trim();
    if (!text) return [];

    let report;
    try {
      report = JSON.parse(text);
    } catch {
      return [];
    }
    if (!Array.isArray(report)) return [];

    return report.map((issue) => {
      const loc = issue.location || {};
      const lines = loc.lines || {};
      const begin = (loc.positions && loc.positions.begin) || {};
      // CodeClimate locations come as either { lines: { begin } } or
      // { positions: { begin: { line, column } } }.
      let line = lines.begin != null ? lines.begin : begin.line;
      if (line && typeof line === 'object') line = line.line;
      return createViolation({
        file: this._relativize(loc.path || ''),
        line: Number(line) || 0,
        col: Number(begin.column) || 0,
        ruleId: issue.check_name || 'ansible-lint',
        severity: mapSeverity(issue.severity),
        message: issue.description || '',
        source: 'ansible-lint',
      });
    });
  }
}

module.exports = AnsibleLintAdapter;
