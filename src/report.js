import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PACKAGES = new Set([
  'react', 'react-dom', 'vue', 'svelte', 'solid-js', '@angular/core',
  'next', 'nuxt', 'vite', 'webpack', 'typescript',
  'antd', 'element-plus', 'naive-ui', 'vuetify', 'primevue', 'primereact',
  'rc-table', '@rc-component/table', '@mui/material', '@mui/joy',
  '@mantine/core', '@chakra-ui/react', '@headlessui/react', '@headlessui/vue',
  '@arco-design/web-react', '@arco-design/web-vue',
]);
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const SECTIONS = ['optionalDependencies', 'dependencies', 'devDependencies', 'peerDependencies'];
const OMITTED_SPEC = '<non-semver spec omitted>';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPackageName(value) {
  return typeof value === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function safeSpec(value) {
  if (typeof value !== 'string') return OMITTED_SPEC;
  const range = value.startsWith('workspace:') ? value.slice(10) : value;
  return range.length > 0 && range.length <= 128 &&
    /^[\dvxX*^~<>=]/.test(range) && /^[\da-zA-Z.*^~<>=|+\-\s]+$/.test(range)
    ? value : OMITTED_SPEC;
}

function safeManager(value) {
  if (value == null) return null;
  return typeof value === 'string' && /^(npm|pnpm|yarn|bun)@\d[\da-zA-Z.+-]*$/.test(value)
    ? value : '<unrecognized packageManager omitted>';
}

export async function collectReport(directory, { extraPackages = [] } = {}) {
  for (const name of extraPackages) {
    if (!isPackageName(name)) throw new Error('Invalid package name. Use a name such as antd or @mui/material.');
  }
  const root = path.resolve(directory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('No package.json found. Pass the directory containing the project package.json.');
    if (error instanceof SyntaxError) throw new Error('The project package.json is not valid JSON.');
    throw new Error('Cannot read the project package.json. Check file permissions.');
  }
  if (!isObject(manifest)) throw new Error('The project package.json must contain a JSON object.');
  for (const section of SECTIONS) {
    if (manifest[section] != null && !isObject(manifest[section])) {
      throw new Error(`The package.json ${section} field must be an object.`);
    }
  }

  const warnings = [];
  const wanted = new Set(extraPackages);
  for (const section of SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (PACKAGES.has(name) || name.startsWith('@radix-ui/')) wanted.add(name);
    }
  }
  const packages = [];
  for (const name of [...wanted].sort()) {
    if (!isPackageName(name)) continue;
    const section = SECTIONS.find((key) => Object.hasOwn(manifest[key] ?? {}, name)) ?? null;
    let installed = null;
    try {
      const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      if (typeof pkg?.version === 'string' && /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(pkg.version)) {
        installed = pkg.version;
      } else {
        warnings.push(`Installed metadata for ${name} does not contain a valid version.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`Could not read installed metadata for ${name}.`);
    }
    packages.push({ name, declared: section ? safeSpec(manifest[section][name]) : null, installed, section });
  }

  const lockfiles = [];
  for (const file of LOCKFILES) {
    try {
      await access(path.join(root, file));
      lockfiles.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`Could not inspect ${file}.`);
    }
  }
  if (lockfiles.length > 1) warnings.push('Multiple lockfiles found; confirm which package manager the project uses.');
  if (packages.some((pkg) => pkg.installed === null)) warnings.push('Some installed versions are unavailable. Run this tool from the relevant workspace package after installing dependencies. Yarn Plug\'n\'Play and packages hoisted outside this directory are not resolved.');

  return {
    schemaVersion: 1,
    environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch() },
    project: { name: typeof manifest.name === 'string' ? manifest.name : null, packageManager: safeManager(manifest.packageManager) },
    lockfiles,
    packages,
    warnings,
  };
}

function cell(value) {
  return String(value ?? 'Not specified')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;').replace(/`/g, '&#96;')
    .replace(/\r\n|\r|\n/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ');
}

export function formatMarkdown(report) {
  const lines = [
    '## Environment', '',
    '| Item | Value |', '| --- | --- |',
    `| Project | ${cell(report.project.name)} |`,
    `| Node.js (report runtime) | ${cell(report.environment.node)} |`,
    `| OS | ${cell(`${report.environment.platform} ${report.environment.release}`)} |`,
    `| Architecture | ${cell(report.environment.arch)} |`,
    `| Package manager (declared) | ${cell(report.project.packageManager)} |`,
    `| Lockfiles (names only) | ${cell(report.lockfiles.join(', ') || 'None found')} |`,
    '', '### Frontend packages', '',
  ];
  if (report.packages.length) {
    lines.push('| Package | Declared range | Installed version | Section |', '| --- | --- | --- | --- |');
    for (const pkg of report.packages) {
      lines.push(`| ${cell(pkg.name)} | ${cell(pkg.declared)} | ${cell(pkg.installed ?? 'Not found')} | ${cell(pkg.section)} |`);
    }
  } else {
    lines.push('No recognized frontend packages found. Use --package NAME to include another package.');
  }
  if (report.warnings.length) lines.push('', '### Notes', '', ...report.warnings.map((warning) => `- ${cell(warning)}`));
  return `${lines.join('\n')}\n`;
}
