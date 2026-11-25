// The built React app, served the way Workers assets serve it: files by path, hashed assets
// cached for a year, and index.html for any other path (single-page-application handling).
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { HOST_META_NAME, type HostId } from "@northstar/contracts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function file(path: string) {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

/**
 * Tags the app's page with its host, so the browser names Google Cloud's infrastructure; the
 * Worker serves the page untouched and the browser falls back to Cloudflare's names.
 */
function tagHost(html: Buffer, host: HostId) {
  return Buffer.from(
    html
      .toString("utf8")
      .replace("<head>", `<head><meta name="${HOST_META_NAME}" content="${host}"/>`),
  );
}

export function staticAssets(directory: string, host?: HostId) {
  const root = resolve(directory);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const candidate = resolve(root, `.${normalize(pathname)}`);
    // Never serve outside the build directory.
    const inside = candidate === root || candidate.startsWith(`${root}${sep}`);
    const found =
      (inside && (await file(candidate))) ||
      (inside && (await file(join(candidate, "index.html")))) ||
      (await file(join(root, "index.html")));
    if (!found) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "content-type": TYPES[extname(found)] ?? "application/octet-stream",
      "cache-control": found.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "x-content-type-options": "nosniff",
    });
    const body = await readFile(found);
    const page = host && extname(found) === ".html" ? tagHost(body, host) : body;
    return new Response(request.method === "HEAD" ? null : page, { headers });
  };
}
