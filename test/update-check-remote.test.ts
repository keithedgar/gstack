/**
 * gstack-update-check resolves its VERSION URL from the checkout's own origin.
 *
 * Hardcoding upstream (raw.githubusercontent.com/garrytan/gstack) makes every
 * fork permanently "out of date": the banner compares the fork's VERSION to
 * upstream's, while /gstack-upgrade pulls origin — so upgrading never clears
 * the prompt.
 */
import { test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(import.meta.dir, '../bin/gstack-update-check');

function repoWithOrigin(url: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-uc-'));
  spawnSync('git', ['init', '-q', dir]);
  if (url) spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  return dir;
}

function resolvedUrl(gstackDir: string): string {
  const r = spawnSync('bash', [SCRIPT, '--print-remote-url'], {
    env: { ...process.env, GSTACK_DIR: gstackDir, GSTACK_REMOTE_URL: '' },
    encoding: 'utf-8',
  });
  return (r.stdout ?? '').trim();
}

test('https fork origin resolves to the fork', () => {
  const dir = repoWithOrigin('https://github.com/someone/gstack.git');
  try {
    expect(resolvedUrl(dir)).toBe('https://raw.githubusercontent.com/someone/gstack/main/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ssh origin resolves to the same owner/repo', () => {
  const dir = repoWithOrigin('git@github.com:someone/gstack.git');
  try {
    expect(resolvedUrl(dir)).toBe('https://raw.githubusercontent.com/someone/gstack/main/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no origin falls back to upstream', () => {
  const dir = repoWithOrigin(null);
  try {
    expect(resolvedUrl(dir)).toBe('https://raw.githubusercontent.com/garrytan/gstack/main/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-GitHub origin falls back to upstream rather than guessing', () => {
  const dir = repoWithOrigin('https://gitlab.com/someone/gstack.git');
  try {
    expect(resolvedUrl(dir)).toBe('https://raw.githubusercontent.com/garrytan/gstack/main/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GSTACK_REMOTE_URL still wins', () => {
  const dir = repoWithOrigin('https://github.com/someone/gstack.git');
  try {
    const r = spawnSync('bash', [SCRIPT, '--print-remote-url'], {
      env: { ...process.env, GSTACK_DIR: dir, GSTACK_REMOTE_URL: 'https://example.test/VERSION' },
      encoding: 'utf-8',
    });
    expect((r.stdout ?? '').trim()).toBe('https://example.test/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
