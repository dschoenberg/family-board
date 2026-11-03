import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { root, validateConfig } from '../server/config.ts';
import { fetchTrendingBooks, HardcoverStore } from '../server/hardcover.ts';

test('Hardcover is optional and a token is required only when enabled', () => {
  const config = parse(readFileSync(join(root, 'config.example.yml'), 'utf8'));
  validateConfig(config);
  config.hardcover.enabled = true;
  assert.throws(() => validateConfig(config), /hardcover.apiToken/);
  config.hardcover.apiToken = 'private-test-token';
  validateConfig(config);
});

test('weekly ranking is hydrated in order and the token stays in the request header', async () => {
  const requests: { query: string; variables?: { ids: number[] } }[] = [];
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-test-token');
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (body.query.includes('books_trending')) return Response.json({ data: { books_trending: { ids: [3, 1, 2] } } });
    return Response.json({ data: { books: [
      { id: 1, title: 'Second', contributions: [{ author: { name: 'Author B' } }] },
      { id: 2, title: 'Third', contributions: [{ author: { name: 'Author C' } }] },
      { id: 3, title: 'First', contributions: [{ author: { name: 'Author A' } }] },
    ] } });
  }) as typeof fetch;
  const books = await fetchTrendingBooks('private-test-token', request);
  assert.deepEqual(books.map(book => book.title), ['First', 'Second', 'Third']);
  assert.deepEqual(requests[1].variables?.ids, [3, 1, 2]);
  assert.equal(JSON.stringify(books).includes('private-test-token'), false);
});

test('a restart uses cached books and failure keeps the last result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'family-board-hardcover-'));
  const config = { enabled: true, apiToken: 'private-test-token', refreshEveryHours: 24 };
  const sample = [{ id: 7, title: 'Saved Book', author: 'Saved Author' }];
  try {
    const first = new HardcoverStore(config, directory, async () => sample);
    await first.init();
    await first.refresh();
    assert.equal(first.status.state, 'ok');
    const second = new HardcoverStore(config, directory, async () => { throw new Error('offline'); });
    await second.init();
    assert.deepEqual(second.items, sample);
    second.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(second.status.state, 'cached');
    second.stop();
    await second.refresh();
    assert.equal(second.status.state, 'stale');
    assert.deepEqual(second.items, sample);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
