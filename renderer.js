const vertexSource = `#version 300 es
layout(location=0) in vec3 home;
layout(location=1) in vec3 color;
uniform vec4 settings;
uniform vec2 orbit;
uniform vec2 viewport;
layout(location=2) in vec2 displacement;
uniform float time;
layout(location=3) in vec3 fallState;
out vec3 tint;
out float grain;
out float opacity;

float noise(float seed) {
  return fract(sin(seed * 0.173) * 43758.5453);
}

void main() {
  float id = float(gl_VertexID);
  vec3 offset = vec3(noise(id * 2.13 + 1.), noise(id * 4.79 + 2.), noise(id * 7.31 + 3.)) - .5;
  vec3 p = vec3(home.xy, home.z * settings.x) + offset * settings.y;
  vec3 phase = offset * 16.;
  p += .006 * sin(time * vec3(.46, .62, .38) + phase);
  p.xy += fallState.xy;
  float c = cos(orbit.x), s = sin(orbit.x);
  p.xz = mat2(c, -s, s, c) * p.xz;
  c = cos(orbit.y);
  s = sin(orbit.y);
  p.yz = mat2(c, s, -s, c) * p.yz;
  float distance = max(.25, settings.w - p.z);
  gl_Position = vec4(p.xy * viewport, distance - .35, distance);
  gl_Position.xy += displacement * distance;
  grain = offset.x + .5;
  gl_PointSize = max(1., settings.z * (1.4 + grain * 1.3) / distance);
  opacity = fallState.z;
  tint = color;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
in vec3 tint;
in float grain;
in float opacity;
out vec4 pixel;

void main() {
  vec2 shape = abs(gl_PointCoord - .5);
  if (shape.x + shape.y * (.55 + grain * .35) > .63) discard;
  if (opacity < .02) discard;
  pixel = vec4(tint * (.76 + .24 * grain), opacity);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) throw new Error('This preview requires a browser with WebGL 2 enabled.');
  const program = gl.createProgram();
  const shaders = [compile(gl, gl.VERTEX_SHADER, vertexSource), compile(gl, gl.FRAGMENT_SHADER, fragmentSource)];
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  for (const shader of shaders) gl.deleteShader(shader);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (let index = 0; index < 2; index++) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, 3, gl.FLOAT, false, 24, index * 12);
  }
  const settings = gl.getUniformLocation(program, 'settings');
  const orbit = gl.getUniformLocation(program, 'orbit');
  const viewport = gl.getUniformLocation(program, 'viewport');
  const timeUniform = gl.getUniformLocation(program, 'time');
  const motionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, motionBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  const fallBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fallBuffer);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  let anchors, motion, velocity, fall, fallVelocity, lifetime;
  let previousTime;
  let span = 0;
  let measuredLine;
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(.047, .051, .067, 1);
  let count = 0;

  return {
    setPoints(points) {
      anchors = points;
      measuredLine = null;
      fall = new Float32Array(points.length / 2);
      fallVelocity = new Float32Array(points.length / 3);
      lifetime = new Float32Array(points.length / 6);
      for (let i = 0; i < lifetime.length; i++) {
        fall[i * 3 + 2] = 1;
        lifetime[i] = .55 + Math.random() * 1.5;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, fallBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, fall.byteLength, gl.DYNAMIC_DRAW);
      motion = new Float32Array(points.length / 3);
      velocity = new Float32Array(motion.length);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, motionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, motion.byteLength, gl.DYNAMIC_DRAW);
      count = points.length / 6;
    },
    draw({ depth, scatter, size, yaw, pitch, zoom, hover, time, emitter, fallSpeed, windAngle }) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const aspect = width / height;
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform4f(settings, depth, scatter, size * ratio, zoom);
      gl.uniform2f(orbit, yaw, pitch);
      gl.uniform2f(viewport, 1.85 / Math.max(1, aspect), 1.85 * Math.min(1, aspect));
      const dt = Math.min(.025, Math.max(0, time - (previousTime ?? time)));
      previousTime = time;
      const windX = Math.sin(windAngle);
      const windY = Math.cos(windAngle);
      const steering = 1 - Math.exp(-8 * dt);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const scale = .925 * Math.min(width, height);
      const radius = 25 * ratio;
      const line = emitter.line;
      let projectedLine = null;
      if (line) {
        const { centerY, sine, cosine } = line;
        if (line !== measuredLine) {
          span = 0;
          for (let i = 0; i < anchors.length; i += 6) {
            span = Math.max(span, sine * anchors[i] + cosine * (anchors[i + 1] - centerY));
          }
          measuredLine = line;
        }
        // The guide sits on the source image plane at z = 0.
        projectedLine = [-1.2, 1.2].map(end => {
          const x = end * cosine;
          const y = centerY - end * sine;
          const z = -sy * x;
          const distance = Math.max(.25, zoom - sp * y - cp * z);
          return { x: .5 + cy * x * scale / distance / width,
            y: .5 - (cp * y - sp * z) * scale / distance / height };
        });
      }
      
      for (let i = 0; i < count; i++) {
        const offset = i * 3;
        const index = i * 2;
        const homeX = anchors[i * 6], homeY = anchors[i * 6 + 1];
        if (line) {
          const below = -line.sine * (homeX + fall[offset])
            - line.cosine * (homeY + fall[offset + 1] - line.centerY);
          const above = Math.max(0, -below);
          const edge = .7 * Math.max(0, 1 - span / .25);
          const progress = 1 - Math.min(1, above / Math.max(span, .0001));
          const approach = .5 + .5 * Math.max(0, 1 - above / .07);
          const speed = .95 * fallSpeed * (edge + (1 - edge) * progress) * approach;
          const turn = Math.max(0, Math.min(1, below / .15));
          const gust = .07 * Math.sin(time * 2 + i * .37) * turn;
          fallVelocity[index] += (speed * (windX * turn + gust) - fallVelocity[index]) * steering;
          fallVelocity[index + 1] += (-speed * (1 + (windY - 1) * turn) - fallVelocity[index + 1]) * steering;
          fall[offset] += fallVelocity[index] * dt;
          fall[offset + 1] += fallVelocity[index + 1] * dt;
          const travel = Math.hypot(fall[offset], fall[offset + 1]);
          const end = lifetime[i];
          fall[offset + 2] = Math.min(1, Math.max(0, (end - travel) / .32));
          if (travel >= end) {
            fall[offset] = fall[offset + 1] = 0;
            fallVelocity[index] = fallVelocity[index + 1] = 0;
          }
        } else {
          fall[offset] = fall[offset + 1] = 0;
          fallVelocity[index] = fallVelocity[index + 1] = 0;
          fall[offset + 2] = 1;
        }
        const x = homeX + fall[offset], y = homeY + fall[offset + 1];
        const z = anchors[i * 6 + 2] * depth;
        const rz = cy * z - sy * x;
        const distance = Math.max(.25, zoom - sp * y - cp * rz);
        const px = (cy * x + sy * z) * scale / distance;
        const py = (cp * y - sp * rz) * scale / distance;
        const dx = px - hover.x * width / 2;
        const dy = py - hover.y * height / 2;
        const length = Math.hypot(dx, dy);
        let targetX = 0, targetY = 0;
        if (hover.active && length < radius * 2) {
          const angle = length > .01 ? Math.atan2(dy, dx) : i * 2.4;
          const rim = radius + length * .2;
          const weight = 1 - Math.min(1, Math.max(0, length / radius - 1));
          const flow = angle + .18 * Math.sin(time * 3 + angle) * weight;
          targetX = (Math.cos(flow) * rim - dx) * weight * 2 / width;
          targetY = (Math.sin(flow) * rim - dy) * weight * 2 / height;
        }
        velocity[index] += (260 * (targetX - motion[index]) - 26 * velocity[index]) * dt;
        velocity[index + 1] += (260 * (targetY - motion[index + 1]) - 26 * velocity[index + 1]) * dt;
        motion[index] += velocity[index] * dt;
        motion[index + 1] += velocity[index + 1] * dt;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, motionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, motion);
      gl.bindBuffer(gl.ARRAY_BUFFER, fallBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, fall);
      gl.uniform1f(timeUniform, time);
      gl.drawArrays(gl.POINTS, 0, count);
      emitter.draw(width, height, ratio, projectedLine);
    },
  };
}
