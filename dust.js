export function createLineGuide(canvas) {
  const context = canvas.getContext('2d');
  return {
    line: null,
    clear() {
      this.line = null;
    },
    draw(width, height, ratio, guide) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      if (!guide) return;
      const [a, b] = guide;
      context.strokeStyle = '#e5f1dabb';
      context.lineWidth = ratio;
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
      for (const point of guide) {
        context.beginPath();
        context.arc(point.x * width, point.y * height, 4 * ratio, 0, 2 * Math.PI);
        context.stroke();
      }
    },
  };
}
