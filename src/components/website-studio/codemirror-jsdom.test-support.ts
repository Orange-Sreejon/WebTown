/**
 * Test support: jsdom has no layout, and its `Range` lacks the measuring
 * methods CodeMirror calls. These stand-ins report empty boxes, which is
 * enough for CodeMirror to run (typing, undo, highlighting) in unit tests.
 * Real rendering is covered by the browser tests.
 */
const emptyRect = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect
const emptyList = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList

if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= emptyList
  Range.prototype.getBoundingClientRect ??= emptyRect
}
