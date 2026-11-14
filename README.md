# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page: no build step, no dependencies, served as it is.

The page is a text document. With script it becomes a night mountain drawn in type, and the text floats over it one card at a time.

- `index.html` is the content. Each card's `id` is a stop.
- `styles.css` is the document, the mountain layout, and the one palette. The scene reads its colours from here.
- `js/direction.js` is the art direction: glyphs, composition, the list of stops, how things move.
- `js/ascii.js` is the scene, `<ascii-scene>`: the sky, and the order everything is drawn in. `js/grid.js` draws every glyph, `js/asterism.js` lays out the name.
- `js/camera.js` is the engine. Everything below the sky is a place in the world at a depth, and one camera puts it on the screen: nearer is larger and passes faster. It goes straight down past the peak, then slides sideways more and more to the last row. What is painted once (the peak, each sheet of the mountain, the ground, the far ranges, every cloud) is a pane, kept as tiles and only moved.
- `js/world.js` paints the peak, and rock anywhere. Below the peak `js/massif.js` is the mountain: the body the peak stands on, and wooded ridges in front of it, each a size of type nearer than the last, with the route and its bridges going down over them. `js/air.js` is the clouds and far ranges, `js/ground.js` the hut and the roots, `js/life.js` the snow, leaves, owl and squirrel.
- `js/main.js` ties cards to stops. `js/gravity.js` is the touch glide that brakes at them.
- `js/gh-activity.js` is `<gh-pulse>`: merged commits read in the visitor's browser, with `data/snapshot.json` behind it.

Run it with any static server, e.g. `python3 -m http.server`.
