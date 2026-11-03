import { join } from 'node:path';
import type { HardcoverConfig } from './config.ts';
import { atomicWrite, limitedBody, readJson } from './io.ts';

export type TrendingBook = { id: number; title: string; author: string };
type Cache = { items: TrendingBook[]; updatedAt: string | null; lastAttemptAt: string | null };
type Status = { state: string; updatedAt: string | null; message: string };

const endpoint = 'https://api.hardcover.app/v1/graphql';
const trendingQuery = 'query { books_trending(duration: week, limit: 3) { ids } }';
const detailsQuery = 'query($ids: [Int!]!) { books(where: { id: { _in: $ids } }) { id title contributions { author { name } } } }';

export async function fetchTrendingBooks(apiToken: string, request: typeof fetch = fetch): Promise<TrendingBook[]> {
  const authorization = /^Bearer\s+/i.test(apiToken.trim()) ? apiToken.trim() : `Bearer ${apiToken.trim()}`;
  async function query<T>(source: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json', 'user-agent': 'family-board/0.1 (personal dashboard)' },
      body: JSON.stringify({ query: source, variables }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    const payload = JSON.parse((await limitedBody(response, 1024 * 1024)).toString('utf8'));
    if (payload.errors?.length || !payload.data) throw new Error('Invalid Hardcover response');
    return payload.data as T;
  }
  const trending = await query<{ books_trending: { ids: number[] } }>(trendingQuery);
  const ids = trending.books_trending?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isInteger(id))) throw new Error('Invalid Hardcover trending list');
  const topIds = [...new Set(ids)].slice(0, 3);
  const details = await query<{ books: { id: number; title: string; contributions?: { author?: { name?: string } }[] }[] }>(detailsQuery, { ids: topIds });
  if (!Array.isArray(details.books)) throw new Error('Invalid Hardcover book details');
  const byId = new Map(details.books.map(book => [book.id, book]));
  return topIds.map(id => {
    const book = byId.get(id);
    if (!book || typeof book.title !== 'string' || !book.title.trim()) throw new Error('Incomplete Hardcover book details');
    const names = [...new Set((book.contributions ?? []).map(c => c.author?.name?.trim()).filter((name): name is string => Boolean(name)))];
    return { id, title: book.title, author: names.slice(0, 2).join(', ') || 'Unknown author' };
  });
}

export class HardcoverStore {
  items: TrendingBook[] = [];
  status: Status = { state: 'unconfigured', updatedAt: null, message: '' };
  lastAttemptAt: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private path: string;
  private config: HardcoverConfig | undefined;
  private reader: typeof fetchTrendingBooks;
  constructor(config: HardcoverConfig | undefined, dataDirectory: string, reader = fetchTrendingBooks) {
    this.config = config;
    this.reader = reader;
    this.path = join(dataDirectory, 'hardcover-trending-week.json');
  }
  async init() {
    if (!this.config?.enabled) return;
    const saved = await readJson<Cache>(this.path);
    if (saved) {
      if (Array.isArray(saved.items) && saved.items.every(item => Number.isInteger(item.id) && typeof item.title === 'string' && typeof item.author === 'string')) this.items = saved.items.slice(0, 3);
      if (saved.updatedAt && Number.isFinite(Date.parse(saved.updatedAt))) this.status.updatedAt = saved.updatedAt;
      if (saved.lastAttemptAt && Number.isFinite(Date.parse(saved.lastAttemptAt))) this.lastAttemptAt = saved.lastAttemptAt;
    }
    this.status.state = this.items.length ? 'cached' : this.lastAttemptAt ? 'error' : 'loading';
    this.status.message = this.items.length ? 'Using saved trending books' : this.lastAttemptAt ? 'Trending books unavailable' : 'Loading trending books';
  }
  start() {
    if (!this.config?.enabled || this.stopped) return;
    const schedule = () => {
      if (this.stopped) return;
      const elapsed = this.lastAttemptAt ? Math.max(0, Date.now() - Date.parse(this.lastAttemptAt)) : Infinity;
      const delay = Math.max(0, this.config!.refreshEveryHours * 3600000 - elapsed);
      this.timer = setTimeout(() => { void this.refresh().finally(schedule); }, delay);
    };
    schedule();
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  async refresh() {
    if (!this.config?.enabled) return;
    this.lastAttemptAt = new Date().toISOString();
    const save = () => atomicWrite(this.path, JSON.stringify({ items: this.items, updatedAt: this.status.updatedAt, lastAttemptAt: this.lastAttemptAt } satisfies Cache));
    try {
      // Persist the attempt first so a reboot cannot repeatedly spend API requests.
      await save();
      const items = await this.reader(this.config.apiToken);
      if (!items.length) throw new Error('Empty Hardcover trending list');
      this.items = items;
      this.status = { state: 'ok', updatedAt: new Date().toISOString(), message: '' };
      await save();
      console.log('Hardcover: trending books updated');
    } catch {
      this.status = { ...this.status, state: this.items.length ? 'stale' : 'error', message: this.items.length ? 'Book refresh unavailable · using saved list' : 'Trending books unavailable' };
      console.error('Hardcover: refresh failed; private details omitted');
    }
  }
}
