import { fetchImageUrls } from '@marcus5914/google-photos-album-image-url-fetch';
import { mkdir, readdir, readFile, stat, unlink, utimes } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import type { Config } from './config.ts';
import { root } from './config.ts';
import { atomicWrite, hash, limitedBody, readJson } from './io.ts';

type Photo = { id: string; url?: string; path?: string; date?: number };
type Manifest = { source: string; updatedAt: string; photos: Photo[] };
export class PhotoStore {
  config: Config;
  directory: string;
  photos: Photo[] = [];
  status = { state: 'loading', updatedAt: null as string | null, count: 0, message: 'Loading photos' };
  inflight = new Map<string, Promise<{ bytes: Buffer; type: string }>>();
  serial: Promise<unknown> = Promise.resolve();
  constructor(config: Config, dataDirectory = join(root, 'data')) { this.config = config; this.directory = join(dataDirectory, 'photos'); }
  sourceKey() { return hash(this.config.photos.albumUrl + this.config.photos.provider + this.config.photos.fallbackDirectory); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const saved = await readJson<Manifest>(join(this.directory, 'manifest.json'));
    if (saved?.source === this.sourceKey()) {
      this.photos = saved.photos;
      this.status = { state: 'cached', updatedAt: saved.updatedAt, count: saved.photos.length, message: 'Using saved photos' };
    }
    if (!this.photos.length) this.photos = await this.localPhotos();
  }
  async localPhotos(): Promise<Photo[]> {
    const folder = resolve(root, this.config.photos.fallbackDirectory);
    try {
      return (await readdir(folder, { withFileTypes: true }))
        .filter(f => f.isFile() && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
        .map(f => ({ id: hash(join(folder, f.name)), path: join(folder, f.name) }));
    } catch { return []; }
  }
  async refresh() {
    try {
      let photos: Photo[];
      if (this.config.photos.provider === 'local') photos = await this.localPhotos();
      else {
        if (!this.config.photos.albumUrl) throw new Error('Album not configured');
        const found = await fetchImageUrls(this.config.photos.albumUrl, AbortSignal.timeout(90000));
        if (!found) throw new Error('Album response could not be read');
        photos = found.filter(p => !p.isVideo).map(p => ({ id: hash(p.uid), url: p.url, date: Number.isFinite(p.imageUpdateDate) && p.imageUpdateDate > 0 ? p.imageUpdateDate : undefined }));
      }
      if (!photos.length) throw new Error('No photos');
      const updatedAt = new Date().toISOString();
      await atomicWrite(join(this.directory, 'manifest.json'), JSON.stringify({ source: this.sourceKey(), updatedAt, photos }));
      this.photos = photos;
      this.status = { state: 'ok', updatedAt, count: photos.length, message: '' };
    } catch {
      if (!this.photos.length) this.photos = await this.localPhotos();
      this.status = { ...this.status, state: this.photos.length ? 'stale' : 'error', count: this.photos.length, message: this.photos.length ? 'Photo refresh unavailable · using saved photos' : 'Photos unavailable · check album sharing or add local photos' };
    }
  }
  async availablePhotos() {
    let selected = this.photos;
    // After a restart without internet, offer files actually present on disk first.
    if (this.status.state !== 'ok') {
      const cached = new Set((await readdir(this.directory)).filter(n => n.endsWith('.image')).map(n => n.slice(0, -6)));
      const offline = this.photos.filter(p => p.path || cached.has(p.id));
      if (offline.length) selected = offline;
    }
    return selected.map(p => ({ id: p.id, src: `/photos/${p.id}`, date: p.date }));
  }
  async get(id: string) {
    const photo = this.photos.find(p => p.id === id);
    if (!photo) return null;
    if (photo.path) {
      const info = await stat(photo.path);
      if (info.size > 20 * 1024 * 1024) throw new Error('Local image too large');
      const extension = extname(photo.path).toLowerCase();
      return { bytes: await readFile(photo.path), type: ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' } as Record<string, string>)[extension] };
    }
    const cachedPath = join(this.directory, `${id}.image`);
    const saved = await readJson<{ type: string }>(`${cachedPath}.json`);
    if (saved) {
      try {
        const bytes = await readFile(cachedPath);
        await utimes(cachedPath, new Date(), new Date());
        return { bytes, type: saved.type };
      } catch {}
    }
    if (this.inflight.has(id)) return this.inflight.get(id)!;
    // Serialize downloads and eviction to keep the disk budget deterministic.
    const promise = this.serial.then(async () => {
      const u = new URL(photo.url!);
      if (u.protocol !== 'https:' || !u.hostname.endsWith('.googleusercontent.com')) throw new Error('Invalid photo origin');
      const response = await fetch(`${photo.url}=w1600-h2000`, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      const type = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new Error('Invalid image');
      const bytes = await limitedBody(response, 12 * 1024 * 1024);
      await atomicWrite(cachedPath, bytes);
      await atomicWrite(`${cachedPath}.json`, JSON.stringify({ type }));
      await this.prune();
      return { bytes, type };
    });
    this.inflight.set(id, promise);
    this.serial = promise.catch(() => {});
    try { return await promise; } finally { this.inflight.delete(id); }
  }
  async prune() {
    const files = await Promise.all((await readdir(this.directory)).filter(n => n.endsWith('.image')).map(async name => ({ name, ...await stat(join(this.directory, name)) })));
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let bytes = files.reduce((sum, f) => sum + f.size, 0);
    while (files.length > this.config.photos.maxCachedPhotos || bytes > this.config.photos.maxCacheMegabytes * 1024 * 1024) {
      const file = files.shift();
      if (!file) break;
      bytes -= file.size;
      await unlink(join(this.directory, file.name));
      await unlink(join(this.directory, `${file.name}.json`)).catch(() => {});
    }
  }
}
