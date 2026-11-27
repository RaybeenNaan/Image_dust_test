// The three rows transform image-space vectors into camera right, up and depth.
export function createCameraFrame() {
  return { basis: new Float32Array(9), width: 1, height: 1, scale: 1, zoom: 2.45 };
}

export function updateCamera(frame, camera, width, height) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const m = frame.basis;
  // Column-major storage is shared directly with the ribbon shader.
  m[0] = cy; m[1] = sp * sy; m[2] = -cp * sy;
  m[3] = 0;  m[4] = cp;      m[5] = sp;
  m[6] = sy; m[7] = -sp * cy; m[8] = cp * cy;
  frame.width = width;
  frame.height = height;
  frame.scale = .925 * Math.min(width, height);
  frame.zoom = camera.zoom;
}

export function projectGuidePoint(frame, x, y) {
  const m = frame.basis;
  const pixels = frame.scale / Math.max(.25, frame.zoom - m[2] * x - m[5] * y);
  return {
    x: .5 + m[0] * x * pixels / frame.width,
    y: .5 - (m[1] * x + m[4] * y) * pixels / frame.height,
  };
}

// Each segment is stored left to right in normalized framebuffer coordinates (Y up).
// Include the bend where the projection's minimum camera distance takes effect.
export function projectImageEdges(frame, width, height, segments) {
  const x = width / 2, y = height / 2;
  const corners = [[-x, -y], [x, -y], [x, y], [-x, y]];
  let count = 0, left = Infinity, right = -Infinity;
  function segment(a, b) {
    if (a.x > b.x) [a, b] = [b, a];
    segments.set([a.x, 1 - a.y, b.x, 1 - b.y], count++ * 4);
    left = Math.min(left, a.x);
    right = Math.max(right, b.x);
  }
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
    const a = projectGuidePoint(frame, ax, ay), b = projectGuidePoint(frame, bx, by);
    const da = frame.zoom - .25 - frame.basis[2] * ax - frame.basis[5] * ay;
    const db = frame.zoom - .25 - frame.basis[2] * bx - frame.basis[5] * by;
    if (da * db < 0) {
      const t = da / (da - db);
      const bend = projectGuidePoint(frame, ax + t * (bx - ax), ay + t * (by - ay));
      segment(a, bend);
      segment(bend, b);
    } else {
      segment(a, b);
    }
  }
  return { count, left, right };
}
