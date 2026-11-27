import { projectImageEdges } from './camera.js';
import { LIVE, SLOTS, TAIL_SECONDS, StrandOrder, TrailHistory } from './history.js';

const vertex = `#version 300 es
precision highp float;
precision highp sampler2DArray;
layout(location=0) in uint strand;
layout(location=1) in float side;
uniform sampler2DArray positions;
uniform sampler2D colors;
uniform int columns;
uniform int layers[${SLOTS + 1}];
uniform float ages[${SLOTS + 1}];
uniform mat3 basis;
uniform vec2 viewport;
uniform float scale, zoom, width;
out vec4 tint;
out float edge;

vec4 sampleAt(ivec2 cell, int age) {
  return texelFetch(positions, ivec3(cell, layers[age]), 0);
}
vec3 project(vec3 world) {
  vec3 p = basis * world;
  float distance = max(.25, zoom - p.z);
  return vec3(p.xy * scale / distance, distance);
}
vec2 unit(vec2 v, vec2 fallback) {
  float n = dot(v, v);
  return n > .000001 ? v * inversesqrt(n) : fallback;
}

void main() {
  int id = int(strand >> 4u);
  int oldest = int(strand & 15u);
  ivec2 cell = ivec2(id % columns, id / columns);
  int pair = gl_VertexID / 2;
  int age = clamp(pair - 1, 0, oldest);
  vec4 samplePos = sampleAt(cell, age);
  vec3 p = project(samplePos.xyz);
  vec2 newer = project(sampleAt(cell, max(0, age - 1)).xyz).xy;
  vec2 older = project(sampleAt(cell, min(oldest, age + 1)).xyz).xy;
  vec2 incoming = unit(p.xy - older, unit(newer - p.xy, vec2(0., -1.)));
  vec2 outgoing = unit(newer - p.xy, incoming);
  vec2 tangent = unit(incoming + outgoing, outgoing);
  vec2 normal = vec2(-tangent.y, tangent.x);
  float life = clamp(1. - ages[age] / ${TAIL_SECONDS}, 0., 1.);
  float halfWidth = .5 * width * mix(.2, 1., life);
  // Both sides of a join share the same vertices. Bound the miter at tight turns.
  float miter = min(1.6, 1. / max(.01, dot(tangent, outgoing)));
  edge = side;
  // An extra half pixel covers the antialiased edges of very fine strands.
  vec2 offset = normal * edge * (halfWidth + .5) * miter;
  // Give stationary strands a visible, grain-sized head on their first frame.
  if (pair == 0) offset += tangent * max(.55, halfWidth);
  if (age == oldest && pair > 0) offset -= tangent * max(.55, halfWidth) * life;
  gl_Position = vec4((p.xy + offset) * 2. / viewport * p.z, p.z - .35, p.z);
  float opacity = min(samplePos.w, sampleAt(cell, 0).w) * pow(life, 1.6);
  tint = vec4(texelFetch(colors, cell, 0).rgb, .86 * opacity);
}`;

const fragment = `#version 300 es
precision highp float;
in vec4 tint;
in float edge;
uniform vec2 viewport, imageX;
uniform vec4 imageEdges[6];
uniform int edgeCount;
uniform float fadeHeight;
out vec4 pixel;

float imageOpacity() {
  if (edgeCount == 0) return 1.;
  vec2 uv = gl_FragCoord.xy / viewport;
  float x = clamp(uv.x, imageX.x, imageX.y);
  float bottom = 1e10;
  for (int i = 0; i < edgeCount; i++) {
    vec4 e = imageEdges[i];
    if (x < e.x || x > e.z) continue;
    float y = min(e.y, e.w);
    if (e.z > e.x) y = mix(e.y, e.w, (x - e.x) / (e.z - e.x));
    bottom = min(bottom, y);
  }
  return 1. - smoothstep(0., fadeHeight, bottom - uv.y);
}

void main() {
  float aa = min(1., max(.001, fwidth(edge)));
  pixel = vec4(tint.rgb, tint.a * imageOpacity() * (1. - smoothstep(1. - aa, 1., abs(edge))));
}`;

function makeProgram(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function makeTexture(gl, unit, target) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, texture);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

export function createTrails(gl) {
  const program = makeProgram(gl);
  const u = {};
  for (const name of ['positions', 'colors', 'columns', 'layers', 'ages', 'basis', 'viewport', 'scale', 'zoom', 'width',
    'imageX', 'imageEdges', 'edgeCount', 'fadeHeight']) {
    u[name] = gl.getUniformLocation(program, name);
  }
  gl.useProgram(program);
  gl.uniform1i(u.positions, 0);
  gl.uniform1i(u.colors, 1);
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  const sides = Int8Array.from({ length: 2 * (2 + SLOTS) }, (_, i) => i % 2 ? 1 : -1);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, sides, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.BYTE, false, 0, 0);

  const history = new TrailHistory();
  const imageEdges = new Float32Array(6 * 4);
  let positions, colors, order;
  function upload(field, layer) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, positions);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, field.columns, field.rows, 1,
      gl.RGBA, gl.FLOAT, field.heads);
  }

  return {
    history,
    reset(field) {
      history.clear();
      if (positions) gl.deleteTexture(positions);
      if (colors) gl.deleteTexture(colors);
      positions = makeTexture(gl, 0, gl.TEXTURE_2D_ARRAY);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, field.columns, field.rows, SLOTS + 1);
      colors = makeTexture(gl, 1, gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, field.columns, field.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.colors);
      order = new StrandOrder(field.count);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, order.ids.byteLength, gl.DYNAMIC_DRAW);
    },
    capture(field) {
      upload(field, history.capture(field.tick));
    },
    draw(field, frame, size, pixelRatio) {
      if (!field.count) return;
      history.prepare(field.tick);
      if (history.layers[0] === LIVE) upload(field, LIVE);
      const visible = order.update(field, frame.basis, history);
      if (!visible) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, order.sorted, 0, visible);
      gl.uniformMatrix3fv(u.basis, false, frame.basis);
      gl.uniform1iv(u.layers, history.layers);
      gl.uniform1fv(u.ages, history.ages);
      gl.uniform1i(u.columns, field.columns);
      gl.uniform2f(u.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(u.scale, frame.scale * pixelRatio);
      gl.uniform1f(u.zoom, frame.zoom);
      gl.uniform1f(u.width, size * pixelRatio);
      if (field.line) {
        const bounds = projectImageEdges(frame, field.width, field.height, imageEdges);
        gl.uniform4fv(u.imageEdges, imageEdges);
        gl.uniform2f(u.imageX, bounds.left, bounds.right);
        gl.uniform1i(u.edgeCount, bounds.count);
        gl.uniform1f(u.fadeHeight, 10 / frame.height);
      } else {
        gl.uniform1i(u.edgeCount, 0);
      }
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (2 + history.length), visible);
      gl.depthMask(true);
    },
  };
}
