import { createLineGuide } from './dust.js';
import { sampleArtwork, sampleImage } from './cloud.js';
import { createRenderer } from './renderer.js';

const get = id => document.getElementById(id);
const canvas = get('view');
const emitter = createLineGuide(get('dust'));
const lineEnabled = get('line');
const lineHeight = get('line-height');
const lineAngle = get('line-angle');
const fallSpeed = get('fall-speed');
const windDirection = get('wind-direction');
fallSpeed.oninput = () => { get('fall-value').textContent = fallSpeed.value + '×'; };
windDirection.oninput = () => {
  const degrees = Number(windDirection.value);
  get('wind-value').textContent = degrees === 0 ? '↓' : Math.abs(degrees) + '° ' + (degrees < 0 ? '↙' : '↘');
};

function syncLine() {
  if (!lineEnabled.checked) {
    emitter.clear();
    return;
  }
  const angle = Number(lineAngle.value) * Math.PI / 180;
  const centerY = 1.25 * (1 - 2 * Number(lineHeight.value) / 100);
  emitter.line = { centerY, sine: Math.sin(angle), cosine: Math.cos(angle) };
}

for (const control of [lineEnabled, lineHeight, lineAngle]) {
  control.addEventListener('input', syncLine);
}

const status = get('status');
const camera = { yaw: 0, pitch: 0, zoom: 2.45 };
let source = sampleArtwork();
let request = 0;
let frame;
let spinning = false;
const hover = { x: 0, y: 0, active: false };
let lastFrame;
const exportButton = get('export');
let drag;
let renderer;
let worker;
let pendingDepth;
const estimate = get('estimate');

function cancelDepth() {
  if (!pendingDepth) return;
  clearTimeout(pendingDepth.timeout);
  pendingDepth = undefined;
  worker?.terminate();
  worker = undefined;
  estimate.disabled = false;
}

function finishDepth(message) {
  clearTimeout(pendingDepth?.timeout);
  pendingDepth = undefined;
  estimate.disabled = false;
  status.textContent = message;
}

function failDepth() {
  cancelDepth();
  status.textContent = 'Automatic depth unavailable. You can retry or import a depth map.';
}

estimate.onclick = () => {
  if (!renderer || pendingDepth) return;
  const id = ++request;
  const image = source;
  estimate.disabled = true;
  status.textContent = 'Estimating depth. The first run downloads the model.';
  pendingDepth = { id, timeout: setTimeout(failDepth, 120000) };
  try {
    worker ??= new Worker('./depth-worker.js', { type: 'module' });
    worker.onerror = failDepth;
    worker.onmessage = ({ data }) => {
      if (data.id !== request || data.id !== pendingDepth?.id) return;
      if (data.error) {
        console.warn(data.error);
        failDepth();
        return;
      }
      try {
        const map = document.createElement('canvas');
        map.width = data.width;
        map.height = data.height;
        map.getContext('2d').putImageData(new ImageData(data.rgba, data.width, data.height), 0, 0);
        updateCloud(sampleImage(image, map));
        finishDepth('Depth source: Depth Anything V2');
      } catch {
        failDepth();
      }
    };
    // Serialize the same decoded orientation used by the preview.
    const input = document.createElement('canvas');
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, 750 / Math.max(width, height));
    input.width = Math.max(1, Math.round(width * scale));
    input.height = Math.max(1, Math.round(height * scale));
    input.getContext('2d').drawImage(image, 0, 0, input.width, input.height);
    worker.postMessage({ id, input: input.toDataURL('image/png') });
  } catch {
    failDepth();
  }
};

function draw() {
  const depth = Number(get('depth').value) / 55;
  renderer.draw({
    ...camera,
    hover,
    emitter,
    fallSpeed: Number(fallSpeed.value),
    windAngle: Number(windDirection.value) * Math.PI / 180,
    time: performance.now() / 1000,
    depth,
    scatter: Number(get('scatter').value) / 45,
    size: Number(get('size').value),
  });
}

function redraw() {
  if (!renderer || frame) return;
  frame = requestAnimationFrame(time => {
    frame = undefined;
    if (!renderer) return;
    if (spinning && lastFrame !== undefined) {
      camera.yaw += Math.min(50, time - lastFrame) * .0006;
    }
    lastFrame = spinning ? time : undefined;
    draw();
    redraw();
  });
}

get('spin').onclick = () => {
  spinning = !spinning;
  lastFrame = undefined;
  get('spin').setAttribute('aria-pressed', String(spinning));
  get('spin').textContent = spinning ? 'Stop orbit' : 'Auto orbit';
  redraw();
};

exportButton.onclick = () => {
  if (!renderer) return;
  draw();
  const image = document.createElement('canvas');
  image.width = canvas.width;
  image.height = canvas.height;
  const context = image.getContext('2d');
  context.drawImage(canvas, 0, 0);
  context.drawImage(get('dust'), 0, 0);
  image.toBlob(blob => {
    if (!blob) {
      status.textContent = 'Could not export the preview.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'point-cloud.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
};

function updateCloud(points) {
  renderer.setPoints(points);
  get('count').textContent = (points.length / 6).toLocaleString() + ' POINTS';
  redraw();
}

async function decode(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

for (const id of ['image', 'map']) {
  get(id).addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || !renderer) return;
    cancelDepth();
    const current = ++request;
    estimate.disabled = true;
    try {
      const image = await decode(file);
      if (current !== request) return;
      if (id === 'image') {
        updateCloud(sampleImage(image));
        source = image;
        get('source').textContent = file.name;
        status.textContent = 'Depth source: image brightness';
      } else {
        updateCloud(sampleImage(source, image));
        status.textContent = 'Depth source: ' + file.name + ' (white is nearer)';
      }
    } catch {
      if (current === request) status.textContent = 'Could not read ' + file.name + '. Try a PNG or JPEG.';
    } finally {
      if (current === request) estimate.disabled = false;
    }
  });
}

for (const id of ['depth', 'scatter', 'size']) get(id).addEventListener('input', redraw);
get('reset').addEventListener('click', () => {
  Object.assign(camera, { yaw: 0, pitch: 0, zoom: 2.45 });
  redraw();
});

function orbit(x, y) {
  camera.yaw += x;
  camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + y));
  redraw();
}

canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  hover.active = false;
  redraw();
  canvas.setPointerCapture(event.pointerId);
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointermove', event => {
  if (!drag && event.pointerType === 'mouse' && event.buttons === 0) {
    const bounds = canvas.getBoundingClientRect();
    hover.x = 2 * (event.clientX - bounds.left) / bounds.width - 1;
    hover.y = 1 - 2 * (event.clientY - bounds.top) / bounds.height;
    hover.active = true;
    redraw();
    return;
  }
  if (event.pointerId !== drag?.id) return;
  orbit((event.clientX - drag.x) * .008, (event.clientY - drag.y) * .008);
  drag.x = event.clientX;
  drag.y = event.clientY;
});
canvas.addEventListener('pointerleave', () => {
  hover.active = false;
  redraw();
});
canvas.addEventListener('lostpointercapture', event => {
  if (event.pointerId === drag?.id) drag = undefined;
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  camera.zoom = Math.max(1.2, Math.min(6, camera.zoom * Math.exp(event.deltaY * .001)));
  redraw();
}, { passive: false });
canvas.addEventListener('keydown', event => {
  const delta = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, -.1], ArrowDown: [0, .1] }[event.key];
  if (!delta) return;
  event.preventDefault();
  orbit(...delta);
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  status.textContent = 'The graphics context was lost. Reload to restore the preview.';
  renderer = undefined;
  exportButton.disabled = true;
});


try {
  renderer = createRenderer(canvas);
  updateCloud(sampleImage(source));
  syncLine();
  exportButton.disabled = false;
} catch (error) {
  status.textContent = error.message;
}
