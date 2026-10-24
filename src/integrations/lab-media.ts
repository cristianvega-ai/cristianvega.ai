// The Lab media: each experiment's clips, posters and scenes live in
// assets/lab/<experiment>/, which never copies into the site as it is.
//
// - In development, a middleware serves them at their production addresses,
//   /lab/media/<experiment>/... and /lab/scenes/<experiment>/<result>/. The
//   scene responses carry the headers of the /lab/scenes/* rule in
//   public/_headers, so a scene runs sandboxed as it does in production.
//   Byte ranges work, because a video must seek.
// - After a build, it copies only the experiments whose page the build
//   wrote. A draft has no page in production, so its media stays out too.
import { createReadStream } from "node:fs";
import { cp, readdir, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const SYSTEM_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const isSystemFile = (path: string) => SYSTEM_FILES.has(basename(path)) || basename(path).startsWith("._");

/** The headers a rule in public/_headers sets, without the ones it detaches. */
export async function readHeaderRule(headersPath: string, rulePath: string): Promise<Record<string, string>> {
  const lines = (await readFile(headersPath, "utf8")).split("\n");
  const headers: Record<string, string> = {};
  let inRule = false;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inRule = line.trim() === rulePath;
      continue;
    }
    const entry = line.trim();
    if (!inRule || entry.startsWith("!")) continue;
    const separator = entry.indexOf(":");
    headers[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return headers;
}

/** The file for a media or scene address, or null when the address leaves the experiment folder. */
function resolveMediaPath(labFolder: string, urlPath: string): string | null {
  const media = urlPath.match(/^\/lab\/media\/([^/]+)\/((?:clips|posters)\/.+)$/);
  const scene = urlPath.match(/^\/lab\/scenes\/([^/]+)\/([^/]+)\/(.*)$/);
  let filePath: string;
  if (media) filePath = join(labFolder, media[1], media[2]);
  else if (scene) filePath = join(labFolder, scene[1], "scenes", scene[2], scene[3] || "index.html");
  else return null;
  const safePath = normalize(filePath);
  return safePath.startsWith(labFolder + sep) ? safePath : null;
}

async function serveFile(request: IncomingMessage, response: ServerResponse, filePath: string, headers: Record<string, string>): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) return false;
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-cache");
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, fileStat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), fileStat.size - 1) : fileStat.size - 1;
    if (start > end) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${fileStat.size}`);
      response.end();
      return true;
    }
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    response.setHeader("Content-Length", String(end - start + 1));
    createReadStream(filePath, { start, end }).pipe(response);
    return true;
  }
  response.setHeader("Content-Length", String(fileStat.size));
  createReadStream(filePath).pipe(response);
  return true;
}

export default function labMedia(): AstroIntegration {
  let rootFolder = "";
  return {
    name: "lab-media",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        rootFolder = fileURLToPath(config.root);
        const labFolder = join(rootFolder, "assets", "lab");
        updateConfig({
          vite: {
            plugins: [{
              name: "lab-media-development",
              configureServer(server) {
                const serveLabMedia = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
                  const urlPath = decodeURIComponent((request.url ?? "").split("?")[0]);
                  if (!urlPath.startsWith("/lab/media/") && !urlPath.startsWith("/lab/scenes/")) return next();
                  const filePath = resolveMediaPath(labFolder, urlPath);
                  const headers = urlPath.startsWith("/lab/scenes/") ? await readHeaderRule(join(rootFolder, "public", "_headers"), "/lab/scenes/*") : {};
                  if (filePath && !isSystemFile(filePath) && (await serveFile(request, response, filePath, headers))) return;
                  response.statusCode = 404;
                  response.end();
                };
                // A scene's opaque origin requests its own scripts across origins.
                // Astro's development guard rejects those requests, and it puts
                // itself first in a hook that runs after this one. This later hook
                // puts the Lab middleware in front of it, for Lab addresses only.
                return () => {
                  server.middlewares.stack.unshift({ route: "", handle: serveLabMedia });
                };
              },
            }],
          },
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        const distFolder = fileURLToPath(dir);
        const labFolder = join(rootFolder, "assets", "lab");
        const experiments = await readdir(labFolder, { withFileTypes: true }).catch(() => []);
        for (const experiment of experiments) {
          if (!experiment.isDirectory()) continue;
          const published = await stat(join(distFolder, "lab", experiment.name, "index.html")).then(() => true, () => false);
          if (!published) continue;
          const source = join(labFolder, experiment.name);
          const copy = (from: string, to: string) => cp(join(source, from), join(distFolder, "lab", ...to.split("/")), { recursive: true, filter: (path) => !isSystemFile(path) });
          await copy("clips", `media/${experiment.name}/clips`);
          await copy("posters", `media/${experiment.name}/posters`);
          await copy("scenes", `scenes/${experiment.name}`);
          logger.info(`copied the media of ${experiment.name}`);
        }
      },
    },
  };
}
