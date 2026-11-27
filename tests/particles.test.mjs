import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraFrame, projectGuidePoint, projectImageEdges, updateCamera } from '../camera.js';
import { createClock, flowSpeed, HZ, ParticleField } from '../simulation.js';
import { SAMPLE_TICKS, SLOTS, StrandOrder, TAIL_SECONDS, TrailHistory } from '../history.js';

const camera = createCameraFrame();
updateCamera(camera, { yaw: 0, pitch: 0, zoom: 2.45 }, 800, 600);
const line = { centerY: 0, sine: 0, cosine: 1 };
const controls = { fallSpeed: 1, windAngle: 0, quickFade: true, depth: 1, scatter: 0, hover: { x: 0, y: 0, active: false } };

function setup(y = -.2) {
  const points = new Float32Array([0, y, .1, .2, .5, 1]);
  const field = new ParticleField({ points, imageWidth: 2, imageHeight: 1 });
  field.setLine(line);
  return field;
}

function replay(fps) {
  const clock = createClock(), field = setup(), history = new TrailHistory();
  const births = [], captures = [];
  for (let frame = 0; frame <= fps * 2; frame++) {
    const steps = clock.steps(frame / fps);
    for (let n = 0; n < steps; n++) {
      field.advance(controls, camera);
      if (!field.opacity[0]) births.push(field.tick);
      if (history.due(field.tick)) {
        captures.push(field.tick);
        history.capture(field.tick);
      }
    }
  }
  return { tick: field.tick, births, captures, y: field.fall[1] };
}

test('distance, recycle ticks and history timestamps match at 20/30/60/120 Hz', () => {
  const reference = replay(120);
  assert.equal(reference.tick, 240);
  assert.ok(reference.births.length > 0);
  for (const fps of [20, 30, 60]) assert.deepEqual(replay(fps), reference);
  const clock = createClock();
  clock.steps(0);
  assert.equal(clock.steps(.025), 3);
  clock.suspend();
  assert.equal(clock.steps(60), 0);
  assert.equal(clock.steps(60 + 1 / 30), 4);
});

test('quick fade times the 0.3-height crossing; distant sources stay dark until revealed', () => {
  const field = setup();
  let crossing;
  while (field.tick < HZ && field.opacity[0] > 0) {
    field.advance(controls, camera);
    if (field.opacity[0] < 1 && crossing === undefined) crossing = field.fadeStart[0];
  }
  assert.ok(crossing > 0);
  const duration = field.tick / HZ - crossing;
  assert.ok(duration >= .1 - 1e-8 && duration < .1 + 1 / HZ);
  assert.equal(field.opacity[0], 0);
  const oldBirth = field.birthTick[0];
  field.advance(controls, camera);
  assert.ok(field.birthTick[0] > oldBirth);
  assert.equal(field.opacity[0], 1);
  const distant = setup(-.4);
  for (let i = 0; i < HZ; i++) distant.advance(controls, camera);
  assert.equal(distant.opacity[0], 0);
  distant.advance({ ...controls, quickFade: false }, camera);
  assert.equal(distant.opacity[0], 1);
});

test('long-fall strands recycle at the bottom even with the line above the image', () => {
  const field = setup(-.45);
  field.setLine({ ...line, centerY: 1 });
  const options = { ...controls, quickFade: false, fallSpeed: .6 };
  while (field.tick < HZ && field.fadeStart[0] < 0) field.advance(options, camera);
  const crossing = field.fadeStart[0];
  assert.ok(crossing > 0 && field.home[1] + field.fall[1] <= -.5);
  while (field.tick < HZ && field.opacity[0] > 0) field.advance(options, camera);
  assert.ok(field.tick / HZ - crossing < .1 + 1 / HZ);
  assert.equal(field.opacity[0], 0);
  field.advance(options, camera);
  assert.equal(field.opacity[0], 1);
});

test('below-line controls leave the upper gradient independent', () => {
  assert.equal(flowSpeed(-1, 1, 2, 3), 0);
  for (const above of [.001, .1, .3, .8]) {
    assert.equal(flowSpeed(-above, 1, 2, .25), flowSpeed(-above, 1, 2, 3));
  }
  assert.ok(flowSpeed(-.001, .001, 2, .25) > .69 * .5 * .95);
  assert.equal(flowSpeed(.5, 1, 2, 3), 3 * .95);
  assert.ok(Math.abs(flowSpeed(-1e-6, 1, 2, .25) - flowSpeed(1e-6, 1, 2, .25)) < 1e-5);
});

test('rotating the source line rotates the flow by the same angle', () => {
  const a = setup(-.2), b = setup(0);
  b.home[0] = -.2;
  b.setLine({ centerY: 0, sine: 1, cosine: 0 });
  for (let i = 0; i < 45; i++) {
    const wind = { ...controls, quickFade: false, windAngle: .65 };
    a.advance(wind, camera);
    b.advance(wind, camera);
  }
  assert.ok(Math.abs(a.fall[1] - b.fall[0]) < 1e-6);
  assert.ok(Math.abs(a.fall[0] + b.fall[1]) < 1e-6);
});

test('wrapped history expires by age and clips every sample from a previous life', () => {
  const h = new TrailHistory();
  for (let t = 0; t <= 95; t += SAMPLE_TICKS) h.capture(t);
  h.prepare(98);
  assert.equal(h.length, SLOTS);
  assert.ok(h.ages[h.length] >= TAIL_SECONDS);
  assert.equal(h.available(96), 0);
  assert.equal(h.available(95), 1);
  assert.equal(h.available(90), 2);
  h.prepare(95);
  assert.equal(h.ages[0], 0);
  assert.equal(h.available(95), 0);
  h.clear();
  h.capture(99);
  h.prepare(100);
  assert.equal(h.available(99), 1);
});

test('transparent instances sort far to near and skip invisible strands', () => {
  const h = new TrailHistory();
  h.prepare(0);
  const order = new StrandOrder(5);
  const heads = new Float32Array([0,0,2,1, 0,0,-3,1, 0,0,-1,1, 0,0,0,0, 0,0,-1,1]);
  const field = { count: 5, heads, birthTick: new Float64Array(5) };
  const visible = order.update(field, camera.basis, h);
  assert.deepEqual([...order.sorted.slice(0, visible)].map(id => id >>> 4), [1,2,4,0]);
});

test('a held cursor keeps a local pocket open and releasing it restores the resting pose', () => {
  const field = setup(0);
  field.setLine(null);
  const active = { ...controls, hover: { active: true, x: 0, y: 0 } };
  for (let i = 0; i < HZ; i++) field.advance(active, camera);
  assert.ok(Math.hypot(field.hover[0], field.hover[1]) > 10);
  for (let i = 0; i < HZ; i++) field.advance(controls, camera);
  assert.ok(field.hover.every(v => v === 0));
  const remote = { ...controls, hover: { active: true, x: 1, y: 1 } };
  for (let i = 0; i < HZ; i++) field.advance(remote, camera);
  assert.ok(field.hover.every(v => v === 0));
});

test('guide endpoints and the particle camera agree under combined pitch and yaw', () => {
  const f = createCameraFrame(), yaw = .71, pitch = -.56, zoom = 1.8;
  updateCamera(f, { yaw, pitch, zoom }, 900, 450);
  const x = .57, y = -.23;
  const rz = -Math.sin(yaw) * x;
  const d = zoom - (Math.sin(pitch) * y + Math.cos(pitch) * rz);
  const p = projectGuidePoint(f, x, y);
  assert.ok(Math.abs(p.x - (.5 + x * Math.cos(yaw) * f.scale / d / f.width)) < 1e-7);
  assert.ok(Math.abs(p.y - (.5 - (Math.cos(pitch) * y - Math.sin(pitch) * rz) * f.scale / d / f.height)) < 1e-7);
});

test('image-edge segments follow the full source rectangle through zoom, orbit and near clipping', () => {
  const f = createCameraFrame(), edges = new Float32Array(6 * 4);
  for (const [yaw, pitch, zoom] of [[0, 0, 3], [.8, -.4, 2], [.75, 1, 1.2]]) {
    updateCamera(f, { yaw, pitch, zoom }, 720, 480);
    const { count, left, right } = projectImageEdges(f, 1.8, 2, edges);
    assert.equal(count, zoom === 1.2 ? 6 : 4);
    for (let i = 0; i <= 100; i++) {
      const t = i / 50 - 1;
      for (const [x, y] of [[.9 * t, -1], [.9 * t, 1], [-.9, t], [.9, t]]) {
        const p = projectGuidePoint(f, x, y);
        assert.ok(left - 1e-6 <= p.x && p.x <= right + 1e-6);
        const onEdge = Array.from({ length: count }, (_, j) => {
          const [ax, ay, bx, by] = edges.subarray(4 * j, 4 * j + 4);
          const dy = 1 - p.y - ay;
          return p.x >= ax - 1e-6 && p.x <= bx + 1e-6
            && Math.abs((bx - ax) * dy - (by - ay) * (p.x - ax)) < 1e-5
            && 1 - p.y >= Math.min(ay, by) - 1e-6 && 1 - p.y <= Math.max(ay, by) + 1e-6;
        }).some(Boolean);
        assert.ok(onEdge);
      }
    }
  }
});
