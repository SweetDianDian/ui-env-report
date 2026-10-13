import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectReport, formatMarkdown } from '../src/report.js';

const cli = fileURLToPath(new URL('../bin/ui-env-report.js', import.meta.url));

async function fixture(t, manifest) {
  const directory = await mkdtemp(join(tmpdir(), 'ui-env-report-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
  return directory;
}

async function installedPackage(directory, name, version) {
  const packageDirectory = join(directory, 'node_modules', ...name.split('/'));
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, 'package.json'),
    JSON.stringify({ name, version }),
  );
}

function runCli(directory, ...args) {
  return spawnSync(process.execPath, [cli, directory, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('keeps a declared version range distinct from an uninstalled package', async (t) => {
  const directory = await fixture(t, {
    name: 'frontend-app',
    dependencies: { react: '^19.0.0', antd: '~5.24.0' },
  });

  const report = await collectReport(directory);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.project.name, 'frontend-app');
  for (const [name, declared] of Object.entries({ react: '^19.0.0', antd: '~5.24.0' })) {
    const dependency = report.packages.find((entry) => entry.name === name);
    assert.ok(dependency, `${name} should appear in the report`);
    assert.equal(dependency.declared, declared);
    assert.equal(dependency.installed, null);
    assert.equal(dependency.section, 'dependencies');
  }
  assert.equal(typeof report.environment.node, 'string');
  assert.equal(report.environment.platform, process.platform);
  assert.equal(report.environment.arch, process.arch);
});

test('reads the installed package version rather than copying its declared range', async (t) => {
  const directory = await fixture(t, {
    dependencies: { react: '^19.0.0' },
  });
  await installedPackage(directory, 'react', '19.1.1');

  const report = await collectReport(directory);
  const react = report.packages.find((entry) => entry.name === 'react');

  assert.equal(react.declared, '^19.0.0');
  assert.equal(react.installed, '19.1.1');
});

test('collects supported dependency sections, package manager and lockfiles', async (t) => {
  const directory = await fixture(t, {
    packageManager: 'pnpm@9.15.0',
    dependencies: { react: '^19.0.0' },
    optionalDependencies: { 'element-plus': '^2.9.0' },
    devDependencies: { vite: '^6.0.0' },
    peerDependencies: { vue: '^3.5.0' },
  });
  await writeFile(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');

  const report = await collectReport(directory);
  const sections = Object.fromEntries(report.packages.map((entry) => [entry.name, entry.section]));

  assert.equal(report.project.packageManager, 'pnpm@9.15.0');
  assert.ok(report.lockfiles.includes('pnpm-lock.yaml'));
  assert.equal(sections.react, 'dependencies');
  assert.equal(sections['element-plus'], 'optionalDependencies');
  assert.equal(sections.vite, 'devDependencies');
  assert.equal(sections.vue, 'peerDependencies');
});

test('omits credential-bearing URLs and local or git dependency specifications', async (t) => {
  const secrets = ['secret-url-token', 'secret-git-token', 'private-local-path'];
  const directory = await fixture(t, {
    dependencies: {
      react: `https://user:${secrets[0]}@example.invalid/react.tgz`,
      'react-dom': `git+https://${secrets[1]}@example.invalid/private/react-dom.git`,
      vue: `file:../${secrets[2]}`,
    },
  });

  const report = await collectReport(directory);
  for (const name of ['react', 'react-dom', 'vue']) {
    const entry = report.packages.find((dependency) => dependency.name === name);
    assert.equal(entry.declared, '<non-semver spec omitted>');
    assert.equal(entry.installed, null);
  }

  const json = JSON.stringify(report);
  const markdown = formatMarkdown(report);
  const result = runCli(directory, '--json');
  assert.equal(result.status, 0, result.stderr);
  for (const secret of secrets) {
    for (const output of [json, markdown, result.stdout, result.stderr]) {
      assert.ok(!output.includes(secret), `report output leaked ${secret}`);
    }
  }
});

test('reports an explicitly requested scoped package through the API and CLI', async (t) => {
  const directory = await fixture(t, {
    dependencies: { '@example/widget': '^1.0.0', '@example/theme': '^2.0.0' },
  });
  await installedPackage(directory, '@example/widget', '1.3.2');

  const report = await collectReport(directory, { extraPackages: ['@example/widget'] });
  const widget = report.packages.find((entry) => entry.name === '@example/widget');
  assert.deepEqual(widget, {
    name: '@example/widget',
    declared: '^1.0.0',
    installed: '1.3.2',
    section: 'dependencies',
  });

  const result = runCli(
    directory, '--json', '--package', '@example/widget', '--package', '@example/theme',
  );
  assert.equal(result.status, 0, result.stderr);
  const cliReport = JSON.parse(result.stdout);
  assert.equal(cliReport.packages.find((entry) => entry.name === '@example/widget').installed, '1.3.2');
  assert.equal(cliReport.packages.find((entry) => entry.name === '@example/theme').declared, '^2.0.0');
});

test('escapes pipes and line breaks in Markdown table values', () => {
  const report = {
    schemaVersion: 1,
    environment: { node: 'v24.0.0', platform: 'test', release: '1.0', arch: 'x64' },
    project: { name: 'frontend-app', packageManager: null },
    lockfiles: [],
    packages: [{
      name: '@example/widget',
      declared: 'left|right\n# injected-heading',
      installed: 'top\r\nbottom',
      section: 'dependencies',
    }],
    warnings: [],
  };

  const markdown = formatMarkdown(report);

  assert.equal(typeof markdown, 'string');
  assert.ok(markdown.includes('@example/widget'));
  assert.ok(!markdown.includes('left|right'), 'an unescaped pipe splits a table cell');
  assert.ok(!markdown.includes('\n# injected-heading'), 'a line break escapes the table');
  assert.ok(!markdown.includes('top\r\nbottom'));
  assert.ok(markdown.includes('left') && markdown.includes('right'), 'escaping should preserve the value');
});

test('invalid root package.json produces a friendly CLI error and exit code 1', async (t) => {
  const directory = await fixture(t, {});
  await writeFile(join(directory, 'package.json'), '{"name":');

  const result = runCli(directory, '--json');

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
  assert.match(result.stderr, /package\.json|JSON/i);
  assert.doesNotMatch(result.stderr, /\n\s+at\s/);
});

test('--json emits exactly one parseable JSON report without informational output', async (t) => {
  const directory = await fixture(t, {
    name: 'json-only-fixture',
    devDependencies: { typescript: '~5.7.0' },
  });

  const result = runCli(directory, '--json');

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.project.name, 'json-only-fixture');
  assert.equal(report.packages.find((entry) => entry.name === 'typescript').installed, null);
});
