# me

[danielwyckoff.ca](https://danielwyckoff.ca). A static page: no build step, no dependencies, served as it is.

The page is a text document. Where the browser has WebGL 2 it becomes a night mountain set in type, and the text floats over it one card at a time. Where it cannot be drawn (no script, no WebGL 2, no graphics card, forced colours) the page stays text and the button to the mountain says why. With reduced motion the page starts as text and the button is there to press.

Three stages, two contracts:

```
world/*  ──►  the model  ──►  pack.js  ──►  instances and textures  ──►  gl.js
 pure         cells and        the only       24 bytes each               knows nothing
              palette names    translator                                 of mountains
```

- `index.html` is the content. Each card's `id` is a stop. `styles.css` is the document, the mountain layout and the palette.
- `js/art.js` is the art direction, as data: palette, layout, stops, the name's letters, trees. `js/math.js` is the shared maths.
- `js/world.js` makes the world from the size of the page, once: `world/sky.js` the stars and the name, `world/peak.js` the painted peak, `world/massif.js` the lobes on their turntable and the route over them, `world/lobe.js` what is painted on a lobe, `world/air.js` clouds, far ranges, snow and leaves, `world/ground.js` the ground and the hut. No DOM, no GL: it runs under Node.
- `js/pack.js` turns the model into runs of instances and one ground texture a lobe.
- `js/glsl.js` is the instance: its 24 bytes, and the two shaders that read them. Snow, leaves, clouds, twinkles, the growth of trees and the dark round your light all happen there.
- `js/gl.js` is the renderer: one program, a glyph atlas set by the browser's own type, two buffers, a table of layers.
- `js/scene.js` is the frame: where the page is, where every layer stands, and the one list of things to draw, back to front.
- `js/live.js` is what is alive in a frame: the name, the lights and their tethers, shooting stars, bridges, lamps, waypoints, the owl and the squirrels.
- `js/cards.js` opens the cards, `js/glide.js` is the scroll, `js/pulse.js` is `<gh-pulse>` (merged commits, read in the visitor's browser, with `data/snapshot.json` behind it), `js/main.js` decides between text and mountain.

Run it with any static server, e.g. `python3 -m http.server`. Add `?fps` to see what a frame costs.
