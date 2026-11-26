let estimator;
self.onmessage = async ({ data: { id, input } }) => {
  try {
    if (!estimator) {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8', device: 'wasm' });
    }
    const { depth } = await estimator(input);
    const { width, height, data } = depth;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const value = data[i * depth.channels];
      rgba.fill(value, i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    }
    self.postMessage({ id, width, height, rgba }, [rgba.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
