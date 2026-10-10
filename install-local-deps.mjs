import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [python, wheelDir] = process.argv.slice(2);
if (!python || !wheelDir) throw new Error('Usage: node install-local-deps.mjs <python.exe> <wheel-folder>');
await mkdir(wheelDir, { recursive: true });

const installed = new Set([
  'torch', 'torchvision', 'numpy', 'pillow', 'safetensors', 'filelock', 'fsspec',
  'typing-extensions', 'sympy', 'networkx', 'jinja2', 'markupsafe', 'mpmath',
  'setuptools', 'pip'
]);
const roots = [
  'huggingface_hub==0.34.2', 'opencv-python', 'tqdm', 'einops',
  'onnxruntime', 'matplotlib', 'fashn-human-parser==0.1.1', 'transformers<5'
];
const normalize = name => name.toLowerCase().replaceAll('_', '-').replaceAll('.', '-');
const requirements = new Map();
const selected = new Map();
const metadataCache = new Map();

function versionParts(value) {
  const match = value.match(/^([0-9]+(?:\.[0-9]+)*)(.*)$/);
  return match ? { nums: match[1].split('.').map(Number), tail: match[2] } : { nums: [], tail: value };
}
function compareVersions(a, b) {
  const aa = versionParts(a), bb = versionParts(b);
  for (let i = 0; i < Math.max(aa.nums.length, bb.nums.length); i++) {
    const diff = (aa.nums[i] || 0) - (bb.nums[i] || 0);
    if (diff) return Math.sign(diff);
  }
  if (!aa.tail && bb.tail) return 1;
  if (aa.tail && !bb.tail) return -1;
  return aa.tail.localeCompare(bb.tail);
}
function satisfies(version, spec) {
  if (!spec) return true;
  return spec.split(',').map(x => x.trim()).filter(Boolean).every(rule => {
    const m = rule.match(/^(===|==|!=|~=|<=|>=|<|>)\s*([0-9][^\s]*)$/);
    if (!m) return true;
    const [, op, target] = m;
    const cmp = compareVersions(version, target);
    if (op === '== ' || op === '===') return cmp === 0;
    if (op === '==') return cmp === 0;
    if (op === '!=') return cmp !== 0;
    if (op === '<') return cmp < 0;
    if (op === '<=') return cmp <= 0;
    if (op === '>') return cmp > 0;
    if (op === '>=') return cmp >= 0;
    if (op === '~=') return cmp >= 0 && version.split('.')[0] === target.split('.')[0];
    return true;
  });
}
function markerApplies(marker) {
  if (!marker) return true;
  if (marker.includes('extra ==')) return false;
  const py = marker.match(/python_version\s*(==|!=|<=|>=|<|>)\s*["']([^"']+)["']/);
  if (py) {
    const cmp = compareVersions('3.12', py[2]);
    if (py[1] === '==' && cmp !== 0) return false;
    if (py[1] === '!=' && cmp === 0) return false;
    if (py[1] === '<' && cmp >= 0) return false;
    if (py[1] === '<=' && cmp > 0) return false;
    if (py[1] === '>' && cmp <= 0) return false;
    if (py[1] === '>=' && cmp < 0) return false;
  }
  if (/sys_platform\s*==\s*["'](?!win32)[^"']+["']/.test(marker)) return false;
  if (/platform_system\s*==\s*["'](?!Windows)[^"']+["']/.test(marker)) return false;
  if (/platform_machine\s*==\s*["'](?!x86_64|AMD64|amd64)[^"']+["']/.test(marker)) return false;
  if (/sys_platform\s*==\s*["']win32["']|platform_system\s*==\s*["']Windows["']|platform_machine\s*==\s*["'](?:x86_64|AMD64|amd64)["']/.test(marker)) return true;
  return true;
}
function parseRequirement(raw) {
  const [expression, marker = ''] = raw.split(';', 2);
  if (!markerApplies(marker.trim())) return null;
  const match = expression.trim().match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(.*)$/);
  if (!match) return null;
  return { name: normalize(match[1]), spec: match[2].trim() };
}
async function getMetadata(name, version) {
  const key = `${name}@${version || 'latest'}`;
  if (metadataCache.has(key)) return metadataCache.get(key);
  const url = version ? `https://pypi.org/pypi/${name}/${version}/json` : `https://pypi.org/pypi/${name}/json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PyPI metadata request failed for ${key}: HTTP ${response.status}`);
  const json = await response.json();
  metadataCache.set(key, json);
  return json;
}
function wheelRank(file) {
  if (!file.filename.endsWith('.whl')) return -1;
  const f = file.filename.toLowerCase();
  if (f.endsWith('-py3-none-any.whl') || f.endsWith('-py2.py3-none-any.whl')) return 10;
  if (!f.includes('win_amd64')) return -1;
  if (f.includes('cp312-cp312-win_amd64')) return 30;
  if (f.includes('cp312-abi3-win_amd64')) return 25;
  if (f.includes('cp37-abi3-win_amd64')) return 20;
  if (/cp(?:39|310|311)-abi3-win_amd64/.test(f)) return 15;
  return -1;
}
async function chooseRelease(name, spec) {
  const latest = await getMetadata(name);
  const versions = Object.keys(latest.releases).filter(v => !/(?:a|b|rc|dev)\d*/i.test(v) && satisfies(v, spec)).sort(compareVersions).reverse();
  for (const version of versions) {
    const release = latest.releases[version] || [];
    const wheel = release.map(file => ({ file, rank: wheelRank(file) })).filter(x => x.rank >= 0).sort((a, b) => b.rank - a.rank)[0];
    if (!wheel) continue;
    const metadata = version === latest.info.version ? latest : await getMetadata(name, version);
    return { version, wheel: wheel.file, requires: metadata.info.requires_dist || [] };
  }
  throw new Error(`No compatible Windows/Python 3.12 wheel found for ${name}${spec ? ` (${spec})` : ''}`);
}

for (const root of roots) {
  const requirement = parseRequirement(root);
  requirements.set(requirement.name, [...(requirements.get(requirement.name) || []), requirement.spec]);
}
const queue = [...requirements.keys()];
while (queue.length) {
  const name = queue.shift();
  if (installed.has(name) || selected.has(name)) continue;
  const specs = requirements.get(name) || [];
  const combined = specs.filter(Boolean).join(',');
  const release = await chooseRelease(name, combined);
  selected.set(name, release);
  process.stdout.write(`Resolved ${name} ${release.version}\n`);
  for (const raw of release.requires) {
    const requirement = parseRequirement(raw);
    if (!requirement || installed.has(requirement.name)) continue;
    const current = requirements.get(requirement.name) || [];
    current.push(requirement.spec);
    requirements.set(requirement.name, current);
    if (!selected.has(requirement.name) && !queue.includes(requirement.name)) queue.push(requirement.name);
  }
}

const wheelPaths = [];
for (const [name, release] of selected) {
  const target = path.join(wheelDir, release.wheel.filename);
  const response = await fetch(release.wheel.url);
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  wheelPaths.push(target);
  process.stdout.write(`Downloaded ${name} ${release.version}\n`);
}
const install = spawnSync(python, ['-m', 'pip', 'install', '--no-index', '--no-deps', ...wheelPaths], { stdio: 'inherit' });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);
