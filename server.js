// Static file server. node:http only — nothing to install, nothing to keep up to date.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

const ROOT = import.meta.dirname;
const PORT = process.env.PORT || 3000;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = resolve(ROOT, '.' + (path === '/' ? '/index.html' : path));

  // never serve outside the deploy directory, whatever the request says
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`serving on ${PORT}`));
