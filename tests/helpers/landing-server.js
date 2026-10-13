import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Serve exactly the fixture, with the same relative asset prefix as Pages.
export async function startLandingServer() {
  const root = new URL('../fixtures/landing/', import.meta.url);
  const types = { 'index.html': 'text/html', 'landing.css': 'text/css', 'demo.css': 'text/css', 'icon128.png': 'image/png' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const name = path === '/mustela/' ? 'index.html' : path.replace('/mustela/', '');
    if (!path.startsWith('/mustela/') || !Object.hasOwn(types, name)) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.writeHead(200, { 'Content-Type': types[name], 'Cache-Control': 'no-store' });
      response.end(await readFile(new URL(name, root)));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mustela/`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
