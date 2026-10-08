import type { APIRoute } from "astro";
import { globeProjectionStyles, globeProjectionVersion } from "../../shared/lyra-globe/projection.ts";

export function getStaticPaths() {
  return [{ params: { version: globeProjectionVersion } }];
}

export const GET: APIRoute = () => new Response(globeProjectionStyles, {
  headers: { "Content-Type": "text/css; charset=utf-8" },
});
