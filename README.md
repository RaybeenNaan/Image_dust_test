# Point Cloud Studio

Run `python3 -m http.server 8766 --bind 127.0.0.1` from this directory and open [the studio](http://127.0.0.1:8766/) in a WebGL 2 browser.

Open an image to turn it into fine colored strands. Hover to part them, drag or use the arrow keys to orbit, and scroll to zoom. Depth and Scatter shape the cloud. Strand width sets the ribbon width in CSS pixels. The counter reports the number of sampled strands.

The line stays on the image plane as you orbit. Height and Angle place it. Above the line the fall builds gradually. Below-line speed and Wind offset control the flow on its lower side. Positive wind turns toward the right end of a horizontal line. Quick fade starts when a strand passes 30% of the image height beyond the line and fades it over 100 milliseconds. Switch it off for a longer fall. In both modes, strands fade across the first 10 CSS pixels beneath the projected image edge and are invisible beyond that distance. Switching Line off returns the image to its resting shape.

Brightness supplies the initial depth. Import an aligned grayscale depth map for more control. White is nearer. **Estimate depth** downloads Depth Anything V2 Small on its first run and performs inference locally in a worker. **Export PNG** captures the current frame and line guide.

## Implementation

- `cloud.js` samples the source colors and depth. `simulation.js` advances the displayed particles at 120 Hz, including hover, wind and recycling.
- `history.js` tracks timestamped trail samples and strand lifetimes. It sorts visible strands back to front in camera space.
- `trails.js` stores positions in a GPU texture ring and renders tapered triangle ribbons. `camera.js` provides the transform shared by hover, ribbons and the guide.
- `renderer.js` coordinates simulation and presentation. `studio.js` connects the preview to image inputs and controls.

Run `node --test tests/particles.test.mjs` with Node 24 to check timing, flow, hover, camera projection, history and transparency order.
