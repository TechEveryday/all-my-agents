import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(APP_ROOT, 'data');
export const ACTIVITY_DIR = path.join(DATA_DIR, 'activity');
export const SCRIPTS_DIR = path.join(APP_ROOT, 'scripts');

export function expandHome(p) {
  if (!p) return p;
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
