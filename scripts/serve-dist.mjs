#!/usr/bin/env node
// Foreground static server for dist/, used as Playwright's webServer.
//
// `astro preview` daemonizes and returns immediately, so Playwright sees the
// command exit and aborts the run. This serves the same directory in the
// foreground and applies the rules DreamHost applies in production:
// trailingSlash "always", a real 404 body with a 404 status, gzip for
// the text types listed in public/.htaccess, and the Cache-Control
// lifetimes for /_astro/, /images/, /js/, and HTML.
//
// Usage:
//   node scripts/serve-dist.mjs
//   PORT=4321 node scripts/serve-dist.mjs

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

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

// Same types Apache compresses in public/.htaccess. The host labels .js as
// text/javascript, so that type must stay here or every script misses gzip.
const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "application/xml",
  "image/svg+xml",
]);

function mediaType(contentType) {
  return contentType.split(";")[0].trim().toLowerCase();
}

function acceptsGzip(req) {
  const accept = req.headers["accept-encoding"];
  const value = Array.isArray(accept) ? accept.join(",") : (accept ?? "");
  return /\bgzip\b/i.test(value);
}

function cacheControlFor(pathname, contentType) {
  if (mediaType(contentType) === "text/html") {
    return "public, max-age=0, must-revalidate";
  }
  if (pathname.startsWith("/_astro/")) {
    return "public, max-age=31536000, immutable";
  }
  if (pathname.startsWith("/images/")) {
    return "public, max-age=604800, stale-while-revalidate=86400";
  }
  if (pathname.startsWith("/js/")) {
    return "public, max-age=3600, stale-while-revalidate=86400";
  }
  return undefined;
}

function send(req, res, status, contentType, body) {
  const pathname = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
  const headers = { "content-type": contentType };
  const cache = cacheControlFor(pathname, contentType);
  if (cache) headers["cache-control"] = cache;
  const compressible = COMPRESSIBLE_TYPES.has(mediaType(contentType));
  if (compressible) headers.vary = "Accept-Encoding";
  if (compressible && acceptsGzip(req)) {
    headers["content-encoding"] = "gzip";
    res.writeHead(status, headers);
    pipeline(body, createGzip(), res).catch(() => {
      if (!res.writableEnded) res.destroy();
    });
    return;
  }
  res.writeHead(status, headers);
  body.pipe(res);
}

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
    if (body) {
      send(req, res, 404, MIME[".html"], createReadStream(notFound));
    } else {
      res.writeHead(404, { "content-type": MIME[".html"] });
      res.end("404");
    }
    return;
  }

  send(
    req,
    res,
    200,
    MIME[extname(target)] ?? "application/octet-stream",
    createReadStream(target),
  );
});

if (!(await statFile(join(distDir, "index.html")))) {
  console.error("serve-dist: dist/index.html is missing — run `npm run build` first");
  process.exit(1);
}

server.listen(port, () => {
  console.log(`serve-dist: serving dist/ at http://localhost:${port}`);
});
