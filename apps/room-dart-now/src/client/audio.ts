/**
 * WebAudio 音效：无外部资源的小合成器。
 * AudioContext 需用户手势后创建（首次点击/按键时 resume）。
 */

type SoundName =
  | 'shoot'
  | 'hit'
  | 'collision'
  | 'score'
  | 'heal'
  | 'timeout'
  | 'eliminated'
  | 'event'
  | 'gameover'
  | 'ready';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** 首次用户手势时调用 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SoundName, opts: { pitch?: number } = {}): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    switch (name) {
      case 'shoot':
        this.noise(0.18, 1200, 0.25);
        break;
      case 'hit':
        this.tone(180, 0.09, 'triangle', 0.5);
        this.noise(0.05, 3000, 0.3);
        break;
      case 'collision':
        this.tone(90, 0.25, 'sawtooth', 0.5);
        this.tone(70, 0.3, 'square', 0.3);
        break;
      case 'score':
        this.tone(440 * (opts.pitch ?? 1), 0.12, 'sine', 0.4);
        this.tone(660 * (opts.pitch ?? 1), 0.18, 'sine', 0.25, 0.06);
        break;
      case 'heal':
        this.tone(520, 0.12, 'sine', 0.3);
        this.tone(780, 0.2, 'sine', 0.3, 0.09);
        break;
      case 'timeout':
        this.tone(220, 0.2, 'square', 0.35);
        this.tone(160, 0.3, 'square', 0.3, 0.15);
        break;
      case 'eliminated':
        this.tone(300, 0.15, 'sawtooth', 0.4);
        this.tone(200, 0.2, 'sawtooth', 0.35, 0.12);
        this.tone(120, 0.35, 'sawtooth', 0.3, 0.26);
        break;
      case 'event':
        this.tone(500, 0.1, 'triangle', 0.3);
        this.tone(750, 0.14, 'triangle', 0.3, 0.08);
        break;
      case 'gameover':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.35, i * 0.14));
        break;
      case 'ready':
        this.tone(600, 0.07, 'sine', 0.25);
        break;
    }
  }

  private tone(freq: number, duration: number, type: OscillatorType, volume: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, cutoff: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const length = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0);
  }
}

export const audio = new AudioEngine();
