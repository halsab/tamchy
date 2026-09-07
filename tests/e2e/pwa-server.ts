import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { EventEmitter } from 'node:events';

export async function artifactServer(initialRoot: string, base: string) {
  let root = initialRoot;
  let port = 0;
  let fail: (path: string) => boolean = () => false;
  let hold: (path: string) => boolean = () => false;
  const requests = new EventEmitter();
  const seen: string[] = [];
  const pending = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    seen.push(pathname);
    requests.emit('request', pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/neighbor/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html><head><title>Neighbor</title></head><body>Neighbor</body></html>',
      );
      return;
    }
    if (pathname === '/neighbor/sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(
        "self.addEventListener('install',event=>event.waitUntil(caches.open('neighbor-cache').then(cache=>cache.put('/neighbor/proof',new Response('neighbor'))))); ",
      );
      return;
    }
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    const path =
      decodeURIComponent(pathname.slice(base.length)) || 'index.html';
    if (path.includes('..')) {
      response.writeHead(400).end();
      return;
    }
    if (hold(path)) {
      pending.add(response);
      response.on('close', () => pending.delete(response));
      return;
    }
    if (fail(path)) {
      response.writeHead(503).end('Controlled failure');
      return;
    }
    try {
      const body = await readFile(resolve(root, path));
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.mp3': 'audio/mpeg',
        '.webp': 'image/webp',
        '.png': 'image/png',
      };
      response.setHeader(
        'Content-Type',
        types[extname(path)] ?? 'application/octet-stream',
      );
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  const start = async () => {
    await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
    port = (server.address() as { port: number }).port;
  };
  const stop = async () => {
    for (const response of pending) response.destroy();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((done) => server.close(() => done()));
  };
  await start();
  return {
    url: `http://127.0.0.1:${port}${base}`,
    start,
    stop,
    seen,
    use: (directory: string) => {
      root = directory;
    },
    fail: (predicate: (path: string) => boolean) => {
      fail = predicate;
    },
    hold: (predicate: (path: string) => boolean) => {
      hold = predicate;
    },
    requested: (predicate: (path: string) => boolean) =>
      new Promise<void>((done) => {
        const listener = (path: string) => {
          if (predicate(path)) {
            requests.off('request', listener);
            done();
          }
        };
        requests.on('request', listener);
      }),
  };
}
