# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page: no build step, no dependencies, served as it is.

The page is a text document. With script it becomes a night mountain drawn in type, and the text floats over it one card at a time.

- `index.html` is the content. Each card's `id` is a stop.
- `styles.css` is the document, the mountain layout, and the one palette. The scene reads its colours from here.
- `js/direction.js` is the art direction: glyphs, composition, the list of stops, how things move.
- `js/ascii.js` is the scene, `<ascii-scene>`: the sky, and the order everything is drawn in. `js/grid.js` draws every glyph, `js/asterism.js` lays out the name.
- `js/camera.js` is the engine: one pinhole camera. Everything below the sky is a place in the world at a depth, and a thing at distance d is drawn 1/d times its size. The horizon is fixed on the screen. Past the peak the camera goes straight down with the page; from the cloud line it also backs away from the mountain and slides a little sideways, so the ground you came down falls behind and the mountain stands further and further off in the sky. Over each bridge it drops a little more, so a bridge always goes down to the terrace it lands on. What is painted once (the mountain, each terrace, the far ranges, every cloud) is a pane, kept as tiles: near, it is painted in more, smaller cells, so no glyph is larger than type gets; far, in smaller type, then in fewer cells. Everything is drawn in one pass from the furthest to the nearest.
- `js/world.js` paints the peak, and rock anywhere. `js/massif.js` is the mountain and the way down it: down the face, across a bridge from its flank, then along the skylines of terraces in switchbacks, with rope bridges over the gaps between spurs, to the hut on the valley floor. `js/trees.js` draws a tree to any height. `js/air.js` is the far ranges and the cloud, `js/life.js` the snow, leaves, owl and squirrel.
- `js/main.js` ties cards to stops. `js/gravity.js` is the touch glide that brakes at them.
- `js/gh-activity.js` is `<gh-pulse>`: merged commits read in the visitor's browser, with `data/snapshot.json` behind it.

Run it with any static server, e.g. `python3 -m http.server`.
