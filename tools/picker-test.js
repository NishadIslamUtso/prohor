/* Deterministic regression cases for picker placement; real geometry is covered by layout-audit.js. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
const source = html.slice(html.indexOf("  function fitMs("), html.indexOf("  function setSeatsMode("));
const dom = new JSDOM('<div class="combo"><button></button><div class="ms"><div class="ms-head"></div><div class="ms-body"></div><div class="ms-foot"><div class="ms-note"></div></div></div></div>');
const q = s => dom.window.document.querySelector(s);
const panel = q(".ms"), button = q("button"), note = q(".ms-note");
let box = { top: 60, bottom: 900 }, host = { top: 200, bottom: 300 };
button.getBoundingClientRect = () => ({ top: host.top, bottom: host.top + 40 });
q(".combo").getBoundingClientRect = () => host;
Object.defineProperty(panel, "offsetParent", { get: () => q(".combo") });
Object.defineProperty(q(".ms-head"), "offsetHeight", { get: () => 80 });
Object.defineProperty(q(".ms-foot"), "offsetHeight", { get: () => note.style.display === "none" ? 40 : 90 });
panel.getBoundingClientRect = () => ({ height: parseFloat(panel.style.maxHeight) || 430 });
panel.scrollIntoView = () => {};
const ctx = vm.createContext({ pageBox: () => box });
vm.runInContext(source, ctx);
const fit = () => ctx.fitMs(panel, button);
fit();
assert.equal(panel.style.maxHeight, "430px");
assert.equal(panel.classList.contains("up"), false);
// The wrapper, not the shorter button, leaves only 180px below: flip upward.
box = { top: 60, bottom: 486 }; host = { top: 350, bottom: 400 };
fit();
assert.equal(panel.classList.contains("up"), true);
assert.equal(panel.style.top, "auto");
// Enough room for rows only if the explanatory note is hidden.
box = { top: 60, bottom: 800 }; host = { top: 310, bottom: 580 };
fit();
assert.equal(note.style.display, "none");
// Resizing must restore the note and discard the old upward positioning.
box = { top: 60, bottom: 1100 }; host = { top: 200, bottom: 300 };
fit();
assert.equal(note.style.display, "");
assert.equal(panel.style.top, "");
assert.equal(panel.classList.contains("up"), false);
// Neither side fits: centre within the pane rather than clip the title/search.
box = { top: 60, bottom: 400 }; host = { top: 200, bottom: 260 };
fit();
assert.equal(panel.style.maxHeight, "332px");
assert.equal(panel.style.top, "-136px");
assert.equal(note.style.display, "");
assert.ok(parseFloat(q(".ms-body").style.maxHeight) >= 100);
// No browser layout (jsdom/print) must remain a safe no-op.
button.getBoundingClientRect = () => ({ bottom: 0 });
const before = panel.style.cssText;
fit();
assert.equal(panel.style.cssText, before);
dom.window.close();
console.log("ALL PICKER PLACEMENT CHECKS PASSED");
