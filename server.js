// Static files plus a telemetry drop-box. node:http only — nothing to install.
//
// The runner's phone POSTs snapshots during a run; anyone (a teammate's laptop, a
// Claude session) pulls them for analysis:
//
//   curl https://form-coach-production.up.railway.app/telemetry            # who has data
//   curl https://form-coach-production.up.railway.app/telemetry/1          # runner 1, JSONL
//   curl .../telemetry/1?latest=1                                          # newest snapshot only
//
// ponytail: stored as JSONL on the container disk, gone on redeploy. It is race-day
// telemetry, not a system of record. Add a Railway volume if it ever needs to survive.

import { createServer } from 'node:http';
import { readFile, appendFile, stat, readdir } from 'node:fs/promises';
import { createReadStream, mkdirSync } from 'node:fs';
import { extname, resolve, sep, join } from 'node:path';

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
const TDIR = process.env.TELEMETRY_DIR || '/tmp/telemetry';
const MAX_BODY = 512 * 1024;        // one snapshot, not an upload service
const MAX_FILE = 20 * 1024 * 1024;  // per runner per day; plenty at one line per 10s
mkdirSync(TDIR, { recursive: true });

const tfile = user => join(TDIR, `runner-${user}.jsonl`);
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();

  // ---- telemetry in ----
  const post = path.match(/^\/telemetry\/([123])$/);
  if (post && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const snap = JSON.parse(body);                    // must at least be JSON
        snap.received = Date.now();
        const f = tfile(post[1]);
        const size = await stat(f).then(s => s.size, () => 0);
        if (size < MAX_FILE) await appendFile(f, JSON.stringify(snap) + '\n');
        res.writeHead(204, cors).end();
      } catch { res.writeHead(400, cors).end('bad json'); }
    });
    return;
  }

  // ---- telemetry out ----
  if (path === '/telemetry' && req.method === 'GET') {
    const files = await readdir(TDIR).catch(() => []);
    const out = [];
    for (const f of files) {
      const m = f.match(/^runner-(\d)\.jsonl$/);
      if (m) out.push({ runner: +m[1], bytes: (await stat(join(TDIR, f))).size });
    }
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  const get = path.match(/^\/telemetry\/([123])$/);
  if (get && req.method === 'GET') {
    try {
      if (url.searchParams.get('latest')) {
        const lines = (await readFile(tfile(get[1]), 'utf8')).trim().split('\n');
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        return res.end(lines[lines.length - 1]);
      }
      await stat(tfile(get[1]));                    // 404 now, not a crash mid-stream
      res.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson' });
      return createReadStream(tfile(get[1])).on('error', () => res.end()).pipe(res);
    } catch { return res.writeHead(404, cors).end('no telemetry yet'); }
  }

  // ---- static ----
  const file = resolve(ROOT, '.' + (path === '/' ? '/index.html' : path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return res.writeHead(403).end('forbidden');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`serving on ${PORT}`));
