# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page with no build step.

- `index.html`, `styles.css`, `js/` — the whole site. No framework, no bundler, no remote dependencies.
- `js/scene.js` — the WebGL night mountain. Camera descends from the summit to the roots as you scroll.
- `js/gh-activity.js` — reads my public GitHub activity in the visitor's browser; `data/snapshot.json` is the fallback.
- `.nojekyll` — tells GitHub Pages to serve the files as they are.

Run it locally with any static server, e.g. `python3 -m http.server`.
