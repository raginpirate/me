# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page with no build step and no dependencies.

- `index.html`, `styles.css`, `js/` are the whole site.
- `js/scene.js` is the WebGL mountain. Stars spell the name, the camera rides a trail from the summit to the roots as you scroll, merged commits light the trail.
- `js/letters.js` is the stroke alphabet the constellation uses.
- `js/gh-activity.js` reads public GitHub activity in the visitor's browser; `data/snapshot.json` is the fallback.
- `.nojekyll` tells GitHub Pages to serve the files as they are.

Run it locally with any static server, e.g. `python3 -m http.server`.
