/*
 * Prohor demo server — one process serves both the real app and the mock-data demo.
 *
 *   /                    the real app, unmodified (its feed is still the live CDN)
 *   /demo                the same app, but fed by a mock CDN that mutates on every poll
 *                        (seats drift, TBA faculties get named, faculties occasionally swap)
 *                        and knows a second semester (Spring 2027) you can switch to, so
 *                        saved-semesters handling can be watched end to end
 *   /mock/connect.json   the mock feed (never touches the real network)
 *
 * Everything else is served straight from the repository root.
 * Run: node demo/server.js  (PORT env optional, default 8000)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const mock = require("./mock.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 8000;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ "Content-Type": type || "text/plain; charset=utf-8" }, extra || {}));
  res.end(body);
}
function safeJoin(root, name) {
  const p = path.normalize(path.join(root, name));
  return p.startsWith(root) ? p : null;
}
function serveFile(res, p) {
  const type = TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
  fs.readFile(p, (err, buf) => {
    if (err) return send(res, 404, "not found");
    const noStore = /mock-connect/.test(p);
    send(res, 200, buf, type, noStore ? { "Cache-Control": "no-store" } : { "Cache-Control": "no-cache" });
  });
}

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"));

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;

  if (p === "/mock/connect.json") {
    const sem = (u.query.sem || "autumn26");
    const body = JSON.stringify(mock.feed(sem));
    return send(res, 200, body, "application/json; charset=utf-8", { "Cache-Control": "no-store" });
  }

  if (p === "/mock/info.json") {
    return send(res, 200, JSON.stringify({ sems: mock.sems, labels: mock.labels }), "application/json");
  }

  if (p === "/demo" || p === "/demo/") {
    // the real index.html with two demo scripts injected after core.js:
    // the shim retargets the feed + hands the mock URL to the seat worker,
    // the panel gives you the semester switch and explains what to watch
    const injected = indexHtml.toString("utf8").replace(
      '<script src="./core.js"></script>',
      '<script src="./core.js"></script>\n<script src="./demo-shim.js"></script>'
    ).replace(
      '<div id="toasts"></div>',
      '<div id="toasts"></div>\n<script src="./demo-panel.js"></script>'
    );
    if (injected.indexOf("demo-shim.js") < 0) return send(res, 500, "injection failed");
    return send(res, 200, injected, "text/html; charset=utf-8");
  }

  // demo assets + everything else straight from the repo
  const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  const file = safeJoin(ROOT, rel);
  if (!file) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found");
    serveFile(res, file);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Prohor demo server");
  console.log("  real app : http://localhost:" + PORT + "/");
  console.log("  mock demo: http://localhost:" + PORT + "/demo");
  console.log("  mock feed: http://localhost:" + PORT + "/mock/connect.json?sem=autumn26|spring27");
});
