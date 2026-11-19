// Discovers installed agent skills (SKILL.md) and plugin commands so the
// Workflow tab can offer them in its Skill/Script dropdowns.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { state } from './store.js';
import { expandHome } from './paths.js';

const HOME = os.homedir();

function frontmatter(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Find SKILL.md files under `dir` up to `depth` levels, skipping trash/caches. */
function findSkillFiles(dir, depth = 4) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d, level) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.trash' || e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isFile() && e.name === 'SKILL.md') out.push(p);
      else if ((e.isDirectory() || e.isSymbolicLink()) && level < depth) walk(p, level + 1);
    }
  };
  walk(dir, 0);
  return out;
}

function pluginNameFor(file) {
  // .../<plugin>/skills/<skill>/SKILL.md → <plugin>
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf('skills');
  return i > 0 ? parts[i - 1] : '';
}

function installedPluginDirs() {
  const dirs = [];
  for (const f of [path.join(HOME, '.claude/plugins/installed_plugins.json')]) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      const plugins = data.plugins || data;
      for (const [key, val] of Object.entries(plugins)) {
        for (const entry of [].concat(val)) {
          if (entry?.installPath) dirs.push({ name: key.split('@')[0], dir: entry.installPath });
        }
      }
    } catch { /* not present */ }
  }
  return dirs;
}

export function discoverSkills() {
  const found = new Map();
  const add = (skill) => {
    if (!found.has(skill.name)) found.set(skill.name, skill);
  };

  // Personal / synced skills for each harness.
  const personal = [
    { dir: path.join(HOME, '.claude/skills'), harness: 'claude', source: 'Claude skills' },
    { dir: path.join(HOME, '.cursor/skills'), harness: 'cursor', source: 'Cursor skills' },
    { dir: path.join(HOME, '.codex/skills'), harness: 'codex', source: 'Codex skills' },
    { dir: path.join(HOME, '.agents/skills'), harness: 'any', source: 'Agent skills' },
  ];
  for (const { dir, harness, source } of personal) {
    for (const f of findSkillFiles(dir, 3)) {
      const fm = frontmatter(f);
      add({ name: fm.name || path.basename(path.dirname(f)), description: fm.description || '', source, harness, file: f, installed: true });
    }
  }

  // Installed Claude plugins.
  for (const { name, dir } of installedPluginDirs()) {
    for (const f of findSkillFiles(dir, 4)) {
      const fm = frontmatter(f);
      const skill = fm.name || path.basename(path.dirname(f));
      add({ name: `${name}:${skill}`, description: fm.description || '', source: `Plugin · ${name}`, harness: 'claude', file: f, installed: true });
    }
  }
  for (const f of findSkillFiles(path.join(HOME, '.claude/plugins/cache'), 6)) {
    const fm = frontmatter(f);
    const plugin = pluginNameFor(f);
    const skill = fm.name || path.basename(path.dirname(f));
    add({ name: plugin ? `${plugin}:${skill}` : skill, description: fm.description || '', source: `Plugin · ${plugin}`, harness: 'claude', file: f, installed: true });
  }

  // Marketplace skills that are available but not necessarily installed.
  const mkt = path.join(HOME, '.claude/plugins/marketplaces');
  if (fs.existsSync(mkt)) {
    for (const market of fs.readdirSync(mkt)) {
      for (const f of findSkillFiles(path.join(mkt, market), 6)) {
        const fm = frontmatter(f);
        const plugin = pluginNameFor(f);
        const skill = fm.name || path.basename(path.dirname(f));
        add({ name: plugin ? `${plugin}:${skill}` : skill, description: fm.description || '', source: `Marketplace · ${market}`, harness: 'claude', file: f, installed: false });
      }
    }
  }

  // Project-level skills in each repo under the repos folder.
  const root = expandHome(state.settings.reposRoot);
  if (root && fs.existsSync(root)) {
    for (const repo of fs.readdirSync(root)) {
      for (const f of findSkillFiles(path.join(root, repo, '.claude/skills'), 2)) {
        const fm = frontmatter(f);
        add({ name: fm.name || path.basename(path.dirname(f)), description: fm.description || '', source: `Repo · ${repo}`, harness: 'claude', file: f, installed: true });
      }
    }
  }

  for (const c of state.skills.custom || []) {
    add({ name: c.name, description: c.description || '', source: 'Added manually', harness: c.harness || 'any', installed: true, custom: true });
  }

  return [...found.values()]
    .map((s) => ({ ...s, enabled: state.skills.enabled[s.name] ?? s.installed }))
    .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
}
