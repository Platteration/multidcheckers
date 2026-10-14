/**
 * The runner CI's browser suite runs on, against the Playwright the lockfile pins. `ubuntu-latest`
 * moves (to Ubuntu 26.04 from 2026-10-19), and a Playwright with no Chromium build for the release
 * it moves to fails `npx playwright install --with-deps chromium` there, and the check job with
 * it. So every job that installs the browser names its release, and that Playwright's own CLI is
 * asked, told the platform, whether it has a build to download for it.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

/** Each job of ci.yml: its name and its own lines, read as the file is indented. */
function jobs(text: string): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = [];
  const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length).split('\n');
  for (const line of body) {
    const start = /^ {2}([\w-]+):\s*$/.exec(line);
    if (start) out.push({ name: start[1]!, lines: [] });
    else if (/^\S/.test(line)) break;
    else out[out.length - 1]?.lines.push(line);
  }
  return out;
}

describe('the runner the browser suite installs Chromium on', () => {
  const installing = jobs(workflow).filter((job) => job.lines.some((line) => /^\s*- run: npx playwright install\b/.test(line)));

  it('is named by its release in every job that installs the browser, never by a moving label', () => {
    expect(installing.map((job) => job.name)).toEqual(['check']);
    for (const job of installing) {
      const runsOn = job.lines.map((line) => /^ {4}runs-on: (\S+)$/.exec(line)?.[1]).filter(Boolean);
      expect([job.name, runsOn]).toEqual([job.name, [expect.stringMatching(/^ubuntu-\d\d\.\d\d$/)]]);
    }
  });

  it('is one the locked Playwright has a Chromium build for', () => {
    const pinned = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.playwright;
    const cli = path.join(root, 'node_modules', 'playwright', 'cli.js');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'playwright', 'package.json'), 'utf8')).version).toBe(pinned);
    for (const job of installing) {
      const release = /^ {4}runs-on: ubuntu-(\d\d\.\d\d)$/m.exec(job.lines.join('\n'))?.[1];
      // What `install --dry-run` lists for a platform it has a build for is the address it would
      // download; for one it has none for, only where the browser would go.
      const plan = execFileSync(process.execPath, [cli, 'install', '--dry-run', 'chromium'], {
        env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: `ubuntu${release}-x64` },
        encoding: 'utf8',
      });
      const chromium = plan.split(/\n\s*\n/).find((block) => /^browser: chromium version /m.test(block)) ?? '';
      expect([job.name, release, /^\s*Download url:\s+https:\/\/\S+chromium-linux\.zip$/m.test(chromium)]).toEqual([job.name, release, true]);
    }
  });
});
