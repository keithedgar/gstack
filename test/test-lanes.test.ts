/**
 * Test-lane integrity.
 *
 * Seven browser test files end their `afterAll` with a hard
 * `setTimeout(() => process.exit(0), 500)` watchdog. The watchdog exists
 * because `bm.close()` can hang on a leaked CDP handle (see the comment in
 * browse/test/commands.test.ts) — but when several test files share one Bun
 * process, the FIRST file to finish kills the whole run with a SUCCESS code,
 * truncating every file after it and masking their failures.
 *
 * The fix is lane separation: those files run one-per-process via
 * `bun run test:browser`, and the default `bun run test` lane excludes them so
 * its exit code is truthful. This test pins that arrangement — a new file that
 * grows a watchdog must be added to the browser lane, not left to poison the
 * unit lane.
 */
import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const SELF = 'test/test-lanes.test.ts';

/** Files allowed to force-exit the process. Must equal the test:browser lane. */
const BROWSER_LANE = [
  'browse/test/batch.test.ts',
  'browse/test/commands.test.ts',
  'browse/test/compare-board.test.ts',
  'browse/test/content-security.test.ts',
  'browse/test/handoff.test.ts',
  'browse/test/security-live-playwright.test.ts',
  'browse/test/snapshot.test.ts',
];

function testFiles(): string[] {
  const out: string[] = [];
  for (const dir of ['browse/test', 'test', 'make-pdf/test']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (!entry.endsWith('.test.ts')) continue;
      const rel = path.posix.join(dir, entry);
      if (rel === SELF) continue;  // this file quotes the pattern it searches for
      out.push(rel);
    }
  }
  return out.sort();
}

/** A watchdog is a process.exit() reached from a test lifecycle hook. */
function hasForcedExit(relPath: string): boolean {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
  return /setTimeout\(\s*\(\)\s*=>\s*process\.exit\(/.test(src);
}

test('only the browser lane force-exits the process', () => {
  const offenders = testFiles().filter(f => hasForcedExit(f) && !BROWSER_LANE.includes(f));
  expect(offenders).toEqual([]);
});

test('every browser-lane file still needs its watchdog', () => {
  const stale = BROWSER_LANE.filter(f => fs.existsSync(path.join(ROOT, f)) && !hasForcedExit(f));
  expect(stale).toEqual([]);
});

test('the browser lane is excluded from the default test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const script: string = pkg.scripts.test;
  for (const f of BROWSER_LANE) {
    expect(script).toContain(path.basename(f));
  }
  // Bun's flag is --path-ignore-patterns; a bare --ignore is silently accepted
  // and does nothing, which is how the eval files leaked into the free suite.
  expect(script).not.toMatch(/\s--ignore\s/);
  expect(script).toContain('--path-ignore-patterns');
});

test('test:browser runs each browser file in its own process', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  expect(pkg.scripts['test:browser']).toBeDefined();
  for (const f of BROWSER_LANE) {
    expect(pkg.scripts['test:browser']).toContain(f);
  }
});
