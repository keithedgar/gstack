/**
 * gstack-update-check follows the checkout's own origin.
 *
 * Hardcoding upstream's VERSION URL makes every fork permanently "out of date":
 * the banner compares the fork's VERSION to upstream's, while /gstack-upgrade
 * pulls origin — so accepting the upgrade never clears the prompt. Measured on
 * a fork at v1.20.0.0 against upstream v1.68.3.0: the banner fired on every
 * skill invocation and could not be satisfied.
 *
 * Falls back to upstream when origin is absent or is not GitHub — a wrong guess
 * is worse than the old default.
 */
import { test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
/** Files a runnable install needs in bin/ before the script gets as far as the flag. */
const STAGED_BIN = ['gstack-update-check', 'gstack-egress-lib.sh'];
const UPSTREAM_VERSION_URL = 'https://raw.githubusercontent.com/garrytan/gstack/main/VERSION';
const UPSTREAM_GIT_URL = 'https://github.com/garrytan/gstack.git';

/** A repo with an origin and a local `main` tracking `origin/main`. */
function repoWithOrigin(url: string | null, opts: { tracking?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-uc-'));
  const git = (...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });
  spawnSync('git', ['init', '-q', '-b', 'main', dir]);
  // A real install is a git repo that contains the script it runs — GSTACK_DIR
  // is both "where the code lives" and "which repo do we track".
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  for (const f of STAGED_BIN) {
    fs.copyFileSync(path.join(REPO_ROOT, 'bin', f), path.join(dir, 'bin', f));
  }
  git('config', 'user.email', 'test@gstack.invalid');
  git('config', 'user.name', 'gstack test');
  if (url) {
    git('remote', 'add', 'origin', url);
    if (opts.tracking !== false) {
      // Fabricate the tracking relationship without a network round-trip.
      fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.0.0\n');
      git('add', 'VERSION');
      git('commit', '-qm', 'init');
      const sha = git('rev-parse', 'HEAD').stdout.trim();
      git('update-ref', 'refs/remotes/origin/main', sha);
      git('branch', '--set-upstream-to=origin/main', 'main');
    }
  }
  return dir;
}

function resolved(gstackDir: string, env: Record<string, string> = {}): { version: string; repo: string } {
  const r = spawnSync('bash', [path.join(gstackDir, 'bin', 'gstack-update-check'), '--print-remote-url'], {
    env: { ...process.env, GSTACK_DIR: gstackDir, GSTACK_REMOTE_URL: '', GSTACK_REMOTE_REPO: '', ...env },
    encoding: 'utf-8',
  });
  const [version = '', repo = ''] = (r.stdout ?? '').trim().split('\n');
  return { version, repo };
}

function withRepo(url: string | null, fn: (dir: string) => void, opts?: { tracking?: boolean }) {
  const dir = repoWithOrigin(url, opts);
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('an https fork origin resolves to the fork, not upstream', () => {
  withRepo('https://github.com/someone/gstack.git', dir => {
    expect(resolved(dir)).toEqual({
      version: 'https://raw.githubusercontent.com/someone/gstack/main/VERSION',
      repo: 'https://github.com/someone/gstack.git',
    });
  });
});

test('an ssh origin resolves to the same owner/repo', () => {
  withRepo('git@github.com:someone/gstack.git', dir => {
    expect(resolved(dir).version).toBe('https://raw.githubusercontent.com/someone/gstack/main/VERSION');
  });
});

test('the tracked branch is used, not a hardcoded main', () => {
  const dir = repoWithOrigin('https://github.com/someone/gstack.git', { tracking: false });
  try {
    const git = (...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf-8' });
    fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.0.0\n');
    git('add', 'VERSION'); git('commit', '-qm', 'init');
    git('checkout', '-qb', 'release');
    git('update-ref', 'refs/remotes/origin/release', git('rev-parse', 'HEAD').stdout.trim());
    git('branch', '--set-upstream-to=origin/release', 'release');
    expect(resolved(dir).version).toBe('https://raw.githubusercontent.com/someone/gstack/release/VERSION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no origin falls back to upstream', () => {
  withRepo(null, dir => {
    expect(resolved(dir)).toEqual({ version: UPSTREAM_VERSION_URL, repo: UPSTREAM_GIT_URL });
  });
});

test('a non-GitHub origin falls back rather than guessing a raw host', () => {
  withRepo('https://gitlab.com/someone/gstack.git', dir => {
    expect(resolved(dir)).toEqual({ version: UPSTREAM_VERSION_URL, repo: UPSTREAM_GIT_URL });
  });
});

test('explicit env overrides still win', () => {
  withRepo('https://github.com/someone/gstack.git', dir => {
    expect(resolved(dir, {
      GSTACK_REMOTE_URL: 'https://example.test/VERSION',
      GSTACK_REMOTE_REPO: 'https://example.test/gstack.git',
    })).toEqual({ version: 'https://example.test/VERSION', repo: 'https://example.test/gstack.git' });
  });
});
