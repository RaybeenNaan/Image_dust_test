function pixels(image, width, height) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const context = surface.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function luminance(data, offset) {
  return (.2126 * data[offset] + .7152 * data[offset + 1] + .0722 * data[offset + 2]) / 255;
}

export function sampleImage(image, depthMap) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 420 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const colors = pixels(image, width, height);
  const depth = depthMap ? pixels(depthMap, width, height) : colors;
  const extent = Math.max(width, height);
  const points = new Float32Array(width * height * 6);
  let used = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (colors[index + 3] < 32) continue;
      points[used++] = (2 * x + 1 - width) / extent;
      points[used++] = (height - 2 * y - 1) / extent;
      points[used++] = luminance(depth, index) - .5;
      points[used++] = colors[index] / 255;
      points[used++] = colors[index + 1] / 255;
      points[used++] = colors[index + 2] / 255;
    }
  }
  return points.subarray(0, used);
}

export function sampleArtwork() {
  const surface = document.createElement('canvas');
  surface.width = 800;
  surface.height = 600;
  const ctx = surface.getContext('2d');
  const backdrop = ctx.createLinearGradient(0, 0, 800, 600);
  backdrop.addColorStop(0, '#14152d');
  backdrop.addColorStop(1, '#303653');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, 800, 600);
  for (let i = 0; i < 55; i++) {
    const angle = i / 55 * Math.PI;
    ctx.strokeStyle = i % 3 === 0 ? '#eaffae' : i % 3 === 1 ? '#8494ff' : '#5ee2ee';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(400, 300, 255, 72, angle, 0, 2 * Math.PI);
    ctx.stroke();
  }
  return surface;
}
