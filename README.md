# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page: no build step, no dependencies, served as it is.

The page is a text document. With script it becomes a night mountain drawn in type, and the text floats over it one card at a time.

- `index.html` is the content. Each card's `id` is a stop.
- `styles.css` is the document, the mountain layout, and the one palette. The scene reads its colours from here.
- `js/direction.js` is the art direction: glyphs, composition, the list of stops, how things move.
- `js/ascii.js` is the scene, `<ascii-scene>`. `js/grid.js` draws every glyph, `js/world.js` paints the mountain, `js/asterism.js` lays out the name.
- `js/main.js` ties cards to stops. `js/gravity.js` is the touch glide that brakes at them.
- `js/gh-activity.js` is `<gh-pulse>`: merged commits read in the visitor's browser, with `data/snapshot.json` behind it.

Run it with any static server, e.g. `python3 -m http.server`.
