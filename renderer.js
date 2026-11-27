import { createCameraFrame, projectGuidePoint, updateCamera } from './camera.js';
import { createClock, ParticleField } from './simulation.js';
import { createTrails } from './trails.js';

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) throw new Error('This preview requires a browser with WebGL 2 enabled.');
  const trails = createTrails(gl);
  const clock = createClock();
  const frame = createCameraFrame();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(.047, .051, .067, 1);
  let field, last, ratio = 1;

  function present() {
    if (!last) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    trails.draw(field, frame, last.size, ratio);
    const line = last.emitter.line;
    let guide;
    if (line) {
      const x = 1.2 * line.cosine, y = 1.2 * line.sine;
      guide = [projectGuidePoint(frame, -x, line.centerY + y), projectGuidePoint(frame, x, line.centerY - y)];
    }
    last.emitter.draw(canvas.width, canvas.height, ratio, guide);
  }

  return {
    setPoints(cloud) {
      field = new ParticleField(cloud);
      trails.reset(field);
      last = undefined;
      clock.suspend();
      return field.count;
    },
    suspend() { clock.suspend(); },
    present,
    draw(options, now) {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
      const w = Math.round(width * ratio), h = Math.round(height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      updateCamera(frame, options, width, height);
      const line = options.emitter.line;
      if (last?.depth !== options.depth || last?.scatter !== options.scatter || (field.line && !line)) {
        trails.history.clear();
      }
      field.setLine(line);
      if (!trails.history.size) {
        field.pose(options, frame);
        trails.capture(field);
      }
      const steps = clock.steps(now);
      for (let s = 0; s < steps; s++) {
        field.advance(options, frame);
        const due = trails.history.due(field.tick);
        if (due || s === steps - 1) {
          // While repelling, the spring integrator already sampled this tick.
          if (!field.hoverSettling) field.pose(options, frame);
          if (due) trails.capture(field);
        }
      }
      last = options;
      present();
    },
  };
}
