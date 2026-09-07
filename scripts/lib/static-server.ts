import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
export async function serveArtifact(dist: string, base: string) {
  const seen: string[] = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    const path =
      decodeURIComponent(pathname.slice(base.length)) || 'index.html';
    if (
      !/^[\w./-]+$/.test(path) ||
      path.startsWith('/') ||
      path.split('/').includes('..')
    ) {
      response.writeHead(400).end();
      return;
    }
    seen.push(path);
    try {
      let bytes = await readFile(join(dist, path));
      const extension = extname(path);
      response.setHeader(
        'Content-Type',
        mimeTypes[extension] ?? 'application/octet-stream',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Vary', 'Accept-Encoding');
      if (
        /\b gzip\b|^gzip\b/.test(request.headers['accept-encoding'] ?? '') &&
        /\.(html|js|css|json|webmanifest)$/.test(path)
      ) {
        bytes = gzipSync(bytes);
        response.setHeader('Content-Encoding', 'gzip');
      }
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}${base}`,
    seen,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
