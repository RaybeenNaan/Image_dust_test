import { HZ } from './simulation.js';

export const SAMPLE_TICKS = 5;
export const TAIL_SECONDS = .4;
export const SLOTS = Math.ceil(TAIL_SECONDS * HZ / SAMPLE_TICKS) + 1;
export const LIVE = SLOTS;

export class TrailHistory {
  constructor() {
    this.ticks = new Float64Array(SLOTS);
    this.layers = new Int32Array(SLOTS + 1);
    this.ages = new Float32Array(SLOTS + 1);
    this.clear();
  }

  clear() {
    this.cursor = -1;
    this.size = 0;
  }

  due(tick) {
    return !this.size || tick - this.ticks[this.cursor] >= SAMPLE_TICKS;
  }

  capture(tick) {
    this.cursor = (this.cursor + 1) % SLOTS;
    this.size = Math.min(SLOTS, this.size + 1);
    this.ticks[this.cursor] = tick;
    return this.cursor;
  }

  prepare(tick) {
    this.layers[0] = LIVE;
    this.length = 0;
    this.newestPast = -Infinity;
    for (let i = 0; i < this.size; i++) {
      const layer = (this.cursor - i + SLOTS) % SLOTS;
      const age = tick - this.ticks[layer];
      if (age === 0) {
        this.layers[0] = layer;
        continue;
      }
      if (!this.length) this.newestPast = this.ticks[layer];
      this.length++;
      this.layers[this.length] = layer;
      this.ages[this.length] = age / HZ;
    }
  }

  // Birth ticks identify strand generations, including a recycle shorter than one sample.
  available(birthTick) {
    return Math.max(0, Math.min(this.length, 1 + Math.floor((this.newestPast - birthTick) / SAMPLE_TICKS)));
  }
}

export class StrandOrder {
  constructor(count) {
    this.ids = new Uint32Array(count);
    this.scratch = new Uint32Array(count);
    this.depth = new Float32Array(count);
    this.keys = new Uint32Array(this.depth.buffer);
    this.buckets = new Uint32Array(2048);
  }

  update(field, basis, history) {
    let visible = 0;
    const heads = field.heads;
    for (let i = 0; i < field.count; i++) {
      const k = i * 4;
      if (heads[k + 3] <= 0) continue;
      this.depth[i] = basis[2] * heads[k] + basis[5] * heads[k + 1] + basis[8] * heads[k + 2];
      // Convert signed IEEE floats to monotonically increasing unsigned keys.
      const bits = this.keys[i];
      this.keys[i] = bits ^ (bits >>> 31 ? 0xffffffff : 0x80000000);
      this.ids[visible++] = (i << 4) | history.available(field.birthTick[i]);
    }

    let input = this.ids, output = this.scratch;
    for (let shift = 0; shift < 32; shift += 11) {
      this.buckets.fill(0);
      for (let i = 0; i < visible; i++) this.buckets[(this.keys[input[i] >>> 4] >>> shift) & 2047]++;
      let start = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        const size = this.buckets[i];
        this.buckets[i] = start;
        start += size;
      }
      for (let i = 0; i < visible; i++) {
        const id = input[i];
        output[this.buckets[(this.keys[id >>> 4] >>> shift) & 2047]++] = id;
      }
      const swap = input; input = output; output = swap;
    }
    this.sorted = input;
    return visible;
  }
}
