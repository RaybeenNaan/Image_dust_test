# Point Cloud Studio

Run `python3 -m http.server 8766 --bind 127.0.0.1` from this folder and open http://127.0.0.1:8766/ in a browser with WebGL 2.

Open an image to see it as a colored point cloud. Drag or use the arrow keys to orbit, scroll to zoom, and use Depth, Scatter, and Point Size to control the cloud. The default preview uses brightness as a rough depth signal. Import a grayscale depth map aligned to the source image for actual relative depth from another tool. White maps to near and black to far. Source files are processed locally.

- `cloud.js` samples an image and optional depth map into interleaved positions and colors.
- `renderer.js` draws the points with custom WebGL 2 shaders.
- `studio.js` manages file input and preview controls.

Choose **Estimate depth** to run Depth Anything V2 Small in a browser worker. The first run needs an internet connection to download the runtime and model. Inference uses the image locally. If estimation fails, the current preview stays usable.

**Auto orbit** rotates the cloud until you choose **Stop orbit**. **Export PNG** saves the current canvas view at its rendered resolution.
