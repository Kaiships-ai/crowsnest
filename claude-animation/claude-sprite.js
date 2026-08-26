// Canonical Claude sprite. Single source of truth for every animation.
// Do not change these numbers. Actions transform this sprite, they never edit it.
// Pulled verbatim from the tutorial demo (viewBox 0 0 107 86).

export const CLAUDE = {
  viewBox: "0 0 107 86",
  fill: "#DD775B",   // the orange, only body color (official name unknown)
  eye: "#000000",
  shapeRendering: "crispEdges",

  // every rect, exact. [x, y, w, h]
  parts: {
    body:      { x: 11, y: 0,  w: 85, h: 65 },
    handLeft:  { x: 0,  y: 21, w: 22, h: 23 },
    handRight: { x: 85, y: 21, w: 22, h: 23 },
    eyeLeft:   { x: 21, y: 11, w: 11, h: 11 },
    eyeRight:  { x: 75, y: 11, w: 11, h: 11 },
    leg1:      { x: 11, y: 60, w: 11, h: 26 },
    leg2:      { x: 32, y: 60, w: 11, h: 26 },
    leg3:      { x: 64, y: 60, w: 11, h: 26 },
    leg4:      { x: 85, y: 60, w: 11, h: 26 },
  },

  // transform origins the demo uses, in svg units (svgOrigin: "x y")
  origins: {
    body:   "53 65",   // center x, base y. lean and squash pivot here
    legHip: [16.5, 37.5, 69.5, 90.5],  // per-leg center x, hip pivot at y 60
    legFoot: 86,       // foot pivot y when standing
    eyes:   "53 16",   // eyes center. blink and widen squash here
  },
};

// Build the exact sprite markup. Pass legs:false only when an action hides them
// behind a prop, never to change the character. Everything else stays.
export function claudeSVG({ legs = true } = {}) {
  const c = CLAUDE.fill, k = CLAUDE.eye, p = CLAUDE.parts;
  const r = (o, fill) => `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${fill}"/>`;
  const legRects = legs
    ? [p.leg1, p.leg2, p.leg3, p.leg4].map(o => r(o, c)).join("")
    : "";
  return (
    `<g id="claude">` +
      legRects +
      `<g id="body">` +
        `<rect id="bdy" x="${p.body.x}" y="${p.body.y}" width="${p.body.w}" height="${p.body.h}" fill="${c}"/>` +
        `<rect id="hand-r" x="${p.handRight.x}" y="${p.handRight.y}" width="${p.handRight.w}" height="${p.handRight.h}" fill="${c}"/>` +
        `<rect id="hand-l" x="${p.handLeft.x}" y="${p.handLeft.y}" width="${p.handLeft.w}" height="${p.handLeft.h}" fill="${c}"/>` +
        `<g id="eyes">` +
          `<rect x="${p.eyeLeft.x}" y="${p.eyeLeft.y}" width="${p.eyeLeft.w}" height="${p.eyeLeft.h}" fill="${k}"/>` +
          `<rect x="${p.eyeRight.x}" y="${p.eyeRight.y}" width="${p.eyeRight.w}" height="${p.eyeRight.h}" fill="${k}"/>` +
        `</g>` +
      `</g>` +
    `</g>`
  );
}
