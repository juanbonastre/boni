const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("./widgets.cjs");

const AREA = { x: 0, y: 30, width: 1920, height: 1050 };

test("new widgets stack at the top right and wrap to a new column", () => {
  const a = W.defaultPlacement(0, "medium", AREA);
  assert.deepEqual(a, { x: 1920 - 404, y: 54, width: 380, height: 260, size: "medium" });
  assert.equal(W.defaultPlacement(1, "medium", AREA).y, 54 + 276);
  const perColumn = Math.floor((1050 - 24) / 276);
  const wrapped = W.defaultPlacement(perColumn, "medium", AREA);
  assert.equal(wrapped.x, 1920 - 404 * 2);
  assert.equal(wrapped.y, 54);
});

test("a saved place is kept; a new size from Boni resets the dragged size but not the position", () => {
  const w = { id: "w", chart_id: "c", size: "large" };
  const kept = W.placementFor(
    w,
    0,
    { x: 100, y: 200, width: 600, height: 400, size: "large" },
    AREA,
  );
  assert.deepEqual(kept, { x: 100, y: 200, width: 600, height: 400, size: "large" });
  const resized = W.placementFor(
    w,
    0,
    { x: 100, y: 200, width: 300, height: 200, size: "small" },
    AREA,
  );
  assert.deepEqual(resized, { x: 100, y: 200, width: 520, height: 340, size: "large" });
  // a desklet's place (no size known): the size of the widget
  const fromDesklet = W.placementFor(
    { ...w, size: "medium" },
    0,
    { x: 1325, y: 25, width: null, height: null, size: null },
    AREA,
  );
  assert.deepEqual(fromDesklet, { x: 1325, y: 25, width: 380, height: 260, size: "medium" });
  const lost = W.placementFor(
    w,
    0,
    { x: 9000, y: 9000, width: 520, height: 340, size: "large" },
    AREA,
    () => false,
  );
  assert.equal(lost.x, W.defaultPlacement(0, "large", AREA).x);
  const huge = W.placementFor(w, 0, { x: 0, y: 0, width: 5000, height: 10, size: "large" }, AREA);
  assert.equal(huge.width, W.MAX.width);
  assert.equal(huge.height, W.MIN.height);
});

test("hidden widgets and the global switch", () => {
  const list = [
    { id: "a", chart_id: "x", size: "medium" },
    { id: "b", chart_id: "y", size: "small" },
    { id: 3 },
  ];
  assert.deepEqual(
    W.visibleWidgets(list, { showWidgets: true, hiddenWidgets: ["b"] }).map((w) => w.id),
    ["a"],
  );
  assert.deepEqual(W.visibleWidgets(list, { showWidgets: false, hiddenWidgets: [] }), []);
});

test("widgets are kept below only on X11 with wmctrl", () => {
  const yes = () => true;
  assert.equal(W.layerTool({ DISPLAY: ":0" }, "linux", yes), "/usr/bin/wmctrl");
  assert.equal(W.layerTool({ DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" }, "linux", yes), null);
  assert.equal(W.layerTool({}, "linux", yes), null);
  assert.equal(
    W.layerTool({ DISPLAY: ":0" }, "linux", () => false),
    null,
  );
  assert.equal(W.layerTool({ DISPLAY: ":0" }, "darwin", yes), null);
});

test("the old desklets' places, by slot", () => {
  const enabled = [
    "boni@juanbonastre:1:1325:25",
    "clock@cinnamon.org:7:10:10",
    "boni@juanbonastre:2:1325:425",
  ];
  const slots = { 1: 2, 2: 1 };
  const places = W.deskletPlaces(enabled, (instance) => slots[instance]);
  assert.deepEqual(places.get(1), { x: 1325, y: 25 });
  assert.deepEqual(places.get(0), { x: 1325, y: 425 });
  assert.equal(places.size, 2);
});
