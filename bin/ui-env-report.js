#!/usr/bin/env node
import { collectReport, formatMarkdown } from '../src/report.js';

const HELP = `ui-env-report — frontend environment reports, without dependencies

Usage: ui-env-report [project-directory] [options]

Options:
  --json            Output JSON instead of Markdown
  --package NAME    Include an extra package (can be repeated)
  --help, -h        Show this help
  --version, -v     Show the tool version

Only package.json, installed package metadata, and lockfile names are read.
No project scripts, package-manager commands, or network requests are run.
Installed versions require node_modules in the selected project directory.
`;

async function main(args) {
  let directory = '.';
  let hasDirectory = false;
  let json = false;
  let positional = false;
  const extraPackages = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!positional && (arg === '--help' || arg === '-h')) { process.stdout.write(HELP); return; }
    if (!positional && (arg === '--version' || arg === '-v')) { process.stdout.write('0.1.0\n'); return; }
    if (!positional && arg === '--json') { json = true; continue; }
    if (!positional && arg === '--') { positional = true; continue; }
    if (!positional && arg === '--package') {
      const name = args[++index];
      if (!name || name.startsWith('-')) throw new Error('--package requires a package name.');
      extraPackages.push(name);
      continue;
    }
    if (!positional && arg.startsWith('-')) throw new Error('Unknown option. Run ui-env-report --help for usage.');
    if (hasDirectory) throw new Error('Pass only one project directory.');
    directory = arg;
    hasDirectory = true;
  }
  const report = await collectReport(directory, { extraPackages });
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report));
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`ui-env-report: ${error.message}\n`);
  process.exitCode = 1;
});
