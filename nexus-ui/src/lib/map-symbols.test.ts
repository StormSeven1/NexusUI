import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarkerSymbolSvg,
  buildMarkerSymbolDataUrl,
  getMarkerSymbolId,
} from "./map-symbols.ts";

test("marker symbol ids remain stable per target type and disposition", () => {
  assert.equal(getMarkerSymbolId("air", "hostile"), "track-air-hostile");
  assert.equal(getMarkerSymbolId("sea", "friendly"), "track-sea-friendly");
  assert.equal(getMarkerSymbolId("underwater", "neutral"), "track-underwater-neutral");
});

test("marker symbol SVGs differ by target type", () => {
  const air = buildMarkerSymbolSvg("air", "hostile");
  const sea = buildMarkerSymbolSvg("sea", "hostile");
  const underwater = buildMarkerSymbolSvg("underwater", "hostile");

  assert.notEqual(air, sea);
  assert.notEqual(sea, underwater);
  assert.notEqual(air, underwater);
});

test("air and sea symbols use explicit plane and ship silhouettes", () => {
  const air = buildMarkerSymbolSvg("air", "hostile");
  const sea = buildMarkerSymbolSvg("sea", "hostile");

  assert.match(air, /M32 8 L37 21 L47 24 L37 27 L33 39/);
  assert.match(sea, /M13 35 L18 27 L46 27 L52 35 L48 41 L17 41 Z/);
});

test("marker symbol output carries disposition color and data url encoding", () => {
  const svg = buildMarkerSymbolSvg("air", "friendly");
  const dataUrl = buildMarkerSymbolDataUrl("air", "friendly");

  assert.match(svg, /#5b9bd5/i);
  assert.match(dataUrl, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(dataUrl.includes(encodeURIComponent("#5b9bd5")));
});
