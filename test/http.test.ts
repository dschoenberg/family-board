import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { root } from '../server/config.ts';

test('HTTP server serves the board but never config or raw cached sources', async () => {
  await mkdir(join(root, 'data', 'tests'), { recursive: true });
  const folder = await mkdtemp(join(root, 'data', 'tests', 'http-'));
  const c = parse(await readFile(join(root, 'config.example.yml'), 'utf8'));
  c.server.port = 23000 + Math.floor(Math.random() * 10000);
  c.calendar.calendars = [];
  c.photos.provider = 'local'; c.photos.albumUrl = 'https://photos.app.goo.gl/private-test-value'; c.photos.fallbackDirectory = folder;
  const path = join(folder, 'config.yml');
  await writeFile(path, stringify(c));
  const child = spawn(process.execPath, ['server/index.ts'], { cwd: root, env: { ...process.env, BOARD_CONFIG: path }, stdio: 'pipe' });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Family Board:')) { clearTimeout(timeout); resolve(); } });
      child.on('exit', () => { clearTimeout(timeout); reject(new Error('Server exited')); });
      child.on('error', reject);
    });
    const base = `http://127.0.0.1:${c.server.port}`;
    assert.equal((await fetch(base)).status, 200);
    const board = await (await fetch(base + '/api/board')).text();
    assert.equal(board.includes('private-test-value'), false);
    assert.equal(board.includes('albumUrl'), false);
    for (const path of ['/config.yml', '/config.example.yml', '/data/photos/manifest.json', '/server/config.ts', '/package.json', '/.env']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/api/board', { method: 'POST' })).status, 405);
    const response = await fetch(base + '/api/board');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
    await rm(folder, { recursive: true, force: true });
  }
});
