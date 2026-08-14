#!/usr/bin/env node
// Foreground static server for dist/, used as Playwright's webServer.
//
// `astro preview` daemonizes and returns immediately, so Playwright sees the
// command exit and aborts the run. This serves the same directory in the
// foreground and applies the two rules DreamHost applies in production:
// trailingSlash "always", and a real 404 body with a 404 status.
//
// Usage:
//   node scripts/serve-dist.mjs
//   PORT=4321 node scripts/serve-dist.mjs

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";

const port = Number(process.env.PORT ?? 4321);
const distDir = resolve(process.cwd(), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function statFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/** Resolve a URL path to a file inside dist/, or null if it escapes or is missing. */
async function resolveTarget(pathname) {
  const candidate = resolve(distDir, `.${decodeURIComponent(pathname)}`);
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) return null;

  const direct = await statFile(candidate);
  if (direct) return candidate;

  const index = join(candidate, "index.html");
  return (await statFile(index)) ? index : null;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${port}`);

  // trailingSlash: "always" — redirect extensionless paths the way Apache does.
  if (!pathname.endsWith("/") && !extname(pathname)) {
    res.writeHead(301, { location: `${pathname}/` });
    res.end();
    return;
  }

  const target = await resolveTarget(pathname);

  if (!target) {
    const notFound = join(distDir, "404.html");
    const body = await statFile(notFound);
    res.writeHead(404, { "content-type": MIME[".html"] });
    if (body) createReadStream(notFound).pipe(res);
    else res.end("404");
    return;
  }

  res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
});

if (!(await statFile(join(distDir, "index.html")))) {
  console.error("serve-dist: dist/index.html is missing — run `npm run build` first");
  process.exit(1);
}

server.listen(port, () => {
  console.log(`serve-dist: serving dist/ at http://localhost:${port}`);
});
