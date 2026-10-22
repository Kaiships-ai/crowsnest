// browse eval helper: drags the first week-row onto the drop zone window.__dragTo names, a
// CSS selector set with `browse js` first ('[data-testid="week-today"]', or
// '[data-testid="week-day"]:nth-child(n)'). The week uses native HTML5 drag, so synthesized
// DragEvents sharing one DataTransfer reach the same handlers a mouse drag does.
(() => {
  const row = document.querySelector('[data-testid="week-row"]');
  const zone = document.querySelector(window.__dragTo);
  if (!row || !zone) return `missing ${row ? "" : "week-row "}${zone ? "" : window.__dragTo}`;
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  row.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return "dropped on " + window.__dragTo;
})();
