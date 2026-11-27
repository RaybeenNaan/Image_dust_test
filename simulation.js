export const HZ = 120;
const DT = 1 / HZ;
const STEERING = 1 - Math.exp(-8 * DT);
const BASE_SPEED = .95;
const FADE_SECONDS = .1;

export function createClock() {
  let previous, remainder = 0;
  return {
    steps(now) {
      const elapsed = previous === undefined ? 0 : Math.max(0, now - previous);
      previous = now;
      remainder += elapsed * HZ;
      const steps = Math.floor(remainder + 1e-8);
      remainder -= steps;
      return steps;
    },
    suspend() { previous = undefined; },
  };
}

function noise(id) {
  let bits = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

function clamp(value) { return Math.max(0, Math.min(1, value)); }

export function flowSpeed(below, span, height, multiplier) {
  if (below < 0) {
    const edge = .7 * clamp(1 - span / (.125 * height));
    const along = clamp(1 + below / Math.max(.00001, span));
    return .5 * BASE_SPEED * (edge + (1 - edge) * along);
  }
  // Start the adjustable flow inside the line so it cannot pull the upper field faster.
  const t = clamp(below / (.045 * height));
  const blend = t * t * (3 - 2 * t);
  return BASE_SPEED * (.5 + (multiplier - .5) * blend);
}

export class ParticleField {
  constructor({ points, imageWidth, imageHeight }) {
    this.width = imageWidth;
    this.height = imageHeight;
    const sourceCount = points.length / 6;
    this.count = Math.ceil(sourceCount / 3);
    // The same padded rectangle can be uploaded directly to a layer of the history texture.
    this.columns = Math.max(1, Math.ceil(Math.sqrt(this.count)));
    this.rows = Math.max(1, Math.ceil(this.count / this.columns));
    const pixels = this.columns * this.rows;
    this.heads = new Float32Array(pixels * 4);
    this.colors = new Uint8Array(pixels * 4);
    this.home = new Float32Array(this.count * 3);
    this.scatter = new Float32Array(this.home.length);
    this.phase = new Float32Array(this.count * 2);
    this.fall = new Float32Array(this.count * 4); // dx, dy, vx, vy
    this.hover = new Float32Array(this.count * 4); // CSS pixels and velocity
    this.birthTick = new Float64Array(this.count);
    this.fadeStart = new Float64Array(this.count).fill(-1);
    this.opacity = new Float32Array(this.count).fill(1);
    this.tick = 0;
    this.line = null;
    this.span = 0;
    this.hoverSettling = 0;
    for (let i = 0; i < this.count; i++) {
      // One stable sample per three source pixels, jittered to avoid vertical striping.
      const source = 6 * (3 * i + Math.floor(noise(i + 1) * Math.min(3, sourceCount - 3 * i)));
      for (let k = 0; k < 3; k++) {
        this.home[3 * i + k] = points[source + k];
        this.scatter[3 * i + k] = noise(3 * i + k + 117) - .5;
        this.colors[4 * i + k] = Math.round(points[source + 3 + k] * 255);
      }
      this.colors[4 * i + 3] = 255;
      const phase = noise(i + 19) * 2 * Math.PI;
      this.phase[2 * i] = Math.sin(phase);
      this.phase[2 * i + 1] = Math.cos(phase);
    }
  }

  setLine(line) {
    if (line === this.line) return;
    this.line = line;
    this.span = 0;
    if (line) {
      for (let h = 0; h < this.home.length; h += 3) {
        this.span = Math.max(this.span, line.sine * this.home[h] + line.cosine * (this.home[h + 1] - line.centerY));
      }
    } else {
      this.fall.fill(0);
      this.fadeStart.fill(-1);
      this.opacity.fill(1);
      this.birthTick.fill(this.tick);
    }
  }

  advance(options, camera) {
    this.tick++;
    if (this.line) this.advanceFlow(options);
    if (options.hover.active) this.hoverSettling = HZ;
    if (this.hoverSettling > 0) {
      this.pose(options, camera, true);
      if (!options.hover.active && --this.hoverSettling === 0) this.hover.fill(0);
    }
  }

  advanceFlow({ fallSpeed, windAngle, quickFade }) {
    const { sine, cosine, centerY } = this.line;
    const time = this.tick * DT;
    const gustSin = Math.sin(time * 2), gustCos = Math.cos(time * 2);
    const cutoff = .3 * this.height;
    const fall = this.fall;
    for (let i = 0; i < this.count; i++) {
      const k = i * 4;
      const homeY = this.home[i * 3 + 1];
      const homeBelow = -sine * this.home[i * 3] - cosine * (homeY - centerY);
      // A source behind the cutoff stays invisible until a control reveals it again.
      if (this.opacity[i] === 0 && quickFade && homeBelow >= cutoff) continue;
      if (this.opacity[i] === 0) this.birthTick[i] = this.tick;
      const below = homeBelow - sine * fall[k] - cosine * fall[k + 1];
      const speed = flowSpeed(below, this.span, this.height, fallSpeed);
      let nx = -sine, ny = -cosine;
      if (below > 0) {
        const turn = clamp(below / (.1 * this.height));
        const gust = .07 * (gustSin * this.phase[2 * i + 1] + gustCos * this.phase[2 * i]);
        const angle = (windAngle + gust) * turn;
        const n = Math.cos(angle), t = Math.sin(angle);
        nx = -sine * n + cosine * t;
        ny = -cosine * n - sine * t;
      }
      fall[k + 2] += (speed * nx - fall[k + 2]) * STEERING;
      fall[k + 3] += (speed * ny - fall[k + 3]) * STEERING;
      const previousY = homeY + fall[k + 1];
      fall[k] += fall[k + 2] * DT;
      fall[k + 1] += fall[k + 3] * DT;
      // Retire a strand at the source image's bottom even in long-fall mode.
      // The render pass enforces the exact pixel limit on the whole ribbon.
      const bottom = -.5 * this.height;
      const y = homeY + fall[k + 1];
      let crossing = Infinity;
      if (y < bottom) crossing = previousY <= bottom ? 0 : (previousY - bottom) / (previousY - y);
      let opacity = 1;
      if (quickFade) {
        const after = homeBelow - sine * fall[k] - cosine * fall[k + 1];
        if (after >= cutoff) crossing = Math.min(crossing, below >= cutoff ? 0 : (cutoff - below) / (after - below));
      } else {
        if (y >= bottom) this.fadeStart[i] = -1;
        const travel = Math.sqrt(fall[k] * fall[k] + fall[k + 1] * fall[k + 1]);
        opacity = clamp((2 * this.height - travel) / (.2 * this.height));
      }
      if (this.fadeStart[i] < 0 && crossing <= 1) this.fadeStart[i] = time - (1 - crossing) * DT;
      if (this.fadeStart[i] >= 0) opacity = Math.min(opacity, clamp(1 - (time - this.fadeStart[i]) / FADE_SECONDS));
      if (opacity < 1e-7) {
        fall[k] = fall[k + 1] = fall[k + 2] = fall[k + 3] = 0;
        this.hover[k] = this.hover[k + 1] = this.hover[k + 2] = this.hover[k + 3] = 0;
        this.fadeStart[i] = -1;
        this.birthTick[i] = this.tick;
        opacity = 0;
      }
      this.opacity[i] = opacity;
    }
  }

  // Sample live world positions for both ribbons and cursor hit testing.
  pose({ depth, scatter, hover }, camera, integrateHover = false) {
    const time = this.tick * DT;
    const sx = .018 * Math.sin(1.4 * time), cx = .018 * Math.cos(1.4 * time);
    const sy = .012 * Math.sin(1.1 * time), cy = .012 * Math.cos(1.1 * time);
    const m = camera.basis, motion = this.hover;
    const cursorX = hover.x * camera.width * .5, cursorY = hover.y * camera.height * .5;
    for (let i = 0; i < this.count; i++) {
      const h = i * 3, k = i * 4, p = i * 2;
      let x = this.home[h] + this.fall[k] + scatter * this.scatter[h] + sx * this.phase[p + 1] + cx * this.phase[p];
      let y = this.home[h + 1] + this.fall[k + 1] + scatter * this.scatter[h + 1] + cy * this.phase[p + 1] - sy * this.phase[p];
      let z = this.home[h + 2] * depth + scatter * this.scatter[h + 2];
      if (this.hoverSettling) {
        const pixels = camera.scale / Math.max(.25, camera.zoom - m[2] * x - m[5] * y - m[8] * z);
        if (integrateHover) {
          let tx = 0, ty = 0;
          if (hover.active) {
            const dx = (m[0] * x + m[6] * z) * pixels - cursorX;
            const dy = (m[1] * x + m[4] * y + m[7] * z) * pixels - cursorY;
            const r2 = dx * dx + dy * dy;
            if (r2 < 2500) {
              const r = Math.sqrt(r2);
              const push = 26 * (1 - r / 50) ** 2;
              tx = (r > .001 ? dx / r : this.phase[p]) * push;
              ty = (r > .001 ? dy / r : this.phase[p + 1]) * push;
            }
          }
          motion[k + 2] += (260 * (tx - motion[k]) - 26 * motion[k + 2]) * DT;
          motion[k + 3] += (260 * (ty - motion[k + 1]) - 26 * motion[k + 3]) * DT;
          motion[k] += motion[k + 2] * DT;
          motion[k + 1] += motion[k + 3] * DT;
        }
        const dx = motion[k] / pixels, dy = motion[k + 1] / pixels;
        x += m[0] * dx + m[1] * dy;
        y += m[4] * dy;
        z += m[6] * dx + m[7] * dy;
      }
      this.heads[k] = x;
      this.heads[k + 1] = y;
      this.heads[k + 2] = z;
      this.heads[k + 3] = this.opacity[i];
    }
  }
}
