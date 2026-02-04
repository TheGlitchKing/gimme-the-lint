#!/usr/bin/env node
'use strict';

// Post-install script for gimme-the-lint
// Runs after npm install to show next steps
// Does NOT auto-setup venv (user should opt-in via `gimme-the-lint install`)

const isGlobal = process.env.npm_config_global === 'true';

console.log('');
console.log('  gimme-the-lint installed successfully!');
console.log('');

if (isGlobal) {
  console.log('  Global install detected. Usage:');
  console.log('    cd your-project');
  console.log('    gimme-the-lint install    Initialize configs & venv');
  console.log('    gimme-the-lint baseline   Create linting baselines');
  console.log('    gimme-the-lint hooks      Install git hooks');
} else {
  console.log('  Next steps:');
  console.log('    npx gimme-the-lint install    Initialize configs & venv');
  console.log('    npx gimme-the-lint baseline   Create linting baselines');
  console.log('    npx gimme-the-lint hooks      Install git hooks');
}

console.log('');
console.log('  Documentation: https://github.com/TheGlitchKing/gimme-the-lint');
console.log('');
