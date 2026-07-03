export type ImageAsset = { id: string; src: string };
export type AudioAsset = { id: string; src: string };
export type AssetId = string;

export class AssetRegistry {
  private images = new Map<string, ImageAsset>();
  private audio = new Map<string, AudioAsset>();
  private imageCache = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();

  registerImage(asset: ImageAsset) { this.register(this.images, asset, 'image'); }
  registerAudio(asset: AudioAsset) { this.register(this.audio, asset, 'audio'); }

  private register<T extends { id: string }>(map: Map<string, T>, asset: T, kind: string) {
    if (!asset.id || !('src' in asset) || !asset.src) throw new Error(`Invalid ${kind} asset registration`);
    if (map.has(asset.id)) throw new Error(`Duplicate ${kind} asset id: ${asset.id}`);
    map.set(asset.id, asset);
  }

  hasImage(id: string) { return this.images.has(id); }
  hasAudio(id: string) { return this.audio.has(id); }
  image(id: string) { return this.imageCache.get(id) ?? null; }
  audioSrc(id: string) { return this.audio.get(id)?.src ?? null; }
  didFail(id: string) { return this.failed.has(id); }

  async preloadImages(ids: Iterable<string> = this.images.keys()) {
    if (typeof Image === 'undefined') return;
    await Promise.all([...new Set(ids)].map(async (id) => {
      if (this.imageCache.has(id) || this.failed.has(id)) return;
      const asset = this.images.get(id);
      if (!asset) { this.failed.add(id); console.warn(`[skyward] Unknown image asset: ${id}`); return; }
      const image = new Image();
      image.decoding = 'async';
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Unable to load ${asset.src}`));
          image.src = asset.src;
        });
        this.imageCache.set(id, image);
      } catch (error) {
        this.failed.add(id);
        console.warn(`[skyward] Asset fallback enabled for ${id}`, error);
      }
    }));
  }
}

export class Registry<T extends { id: string }> {
  private values = new Map<string, T>();
  constructor(private readonly label: string, private readonly validate: (value: T) => void) {}
  register(value: T) {
    if (this.values.has(value.id)) throw new Error(`Duplicate ${this.label} id: ${value.id}`);
    this.validate(value);
    this.values.set(value.id, value);
    return value;
  }
  get(id: string) { return this.values.get(id); }
  require(id: string) {
    const value = this.get(id);
    if (!value) throw new Error(`Unknown ${this.label}: ${id}`);
    return value;
  }
  all() { return [...this.values.values()]; }
}

export class SoundPlayer {
  private lastPlayed = new Map<string, number>();
  private enabled = true;
  constructor(private readonly assets: AssetRegistry) {}
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  isEnabled() { return this.enabled; }
  play(id: string, minimumGap = 90, volume = .35) {
    if (!this.enabled) return;
    const src = this.assets.audioSrc(id);
    if (!src || typeof Audio === 'undefined') return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < minimumGap) return;
    this.lastPlayed.set(id, now);
    const audio = new Audio(src); audio.volume = volume; void audio.play().catch(() => undefined);
  }
}
