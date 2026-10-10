// Zero-dependency discussion threads server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Data shape: { threads: [{ id, title, author, body, createdAt, replies: [Reply] }] }
// Reply:      { id, parentId|null, author, body, createdAt }  (flat; nested by parentId)
let db = { threads: [] };
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {}

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const newId = () => crypto.randomBytes(6).toString('hex');

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 100_000) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','threads',id,'replies']

  if (parts[1] !== 'threads') return send(res, 404, { error: 'not found' });

  // GET /api/threads
  if (parts.length === 2 && req.method === 'GET') {
    const list = db.threads
      .map(({ replies, ...t }) => ({ ...t, replyCount: replies.length }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, list);
  }

  // POST /api/threads  { title, author, body }
  if (parts.length === 2 && req.method === 'POST') {
    const b = await readJson(req);
    const title = clean(b.title, 200);
    const body = clean(b.body, 10000);
    if (!title) return send(res, 400, { error: 'title is required' });
    const thread = {
      id: newId(),
      title,
      author: clean(b.author, 50) || 'Anonymous',
      body,
      createdAt: Date.now(),
      replies: [],
    };
    db.threads.push(thread);
    save();
    return send(res, 201, thread);
  }

  const thread = db.threads.find((t) => t.id === parts[2]);
  if (!thread) return send(res, 404, { error: 'thread not found' });

  // GET /api/threads/:id
  if (parts.length === 3 && req.method === 'GET') return send(res, 200, thread);

  // POST /api/threads/:id/replies  { author, body, parentId? }
  if (parts[3] === 'replies' && parts.length === 4 && req.method === 'POST') {
    const b = await readJson(req);
    const body = clean(b.body, 10000);
    if (!body) return send(res, 400, { error: 'body is required' });
    const parentId = b.parentId || null;
    if (parentId && !thread.replies.some((r) => r.id === parentId)) {
      return send(res, 400, { error: 'parent reply not found' });
    }
    const reply = {
      id: newId(),
      parentId,
      author: clean(b.author, 50) || 'Anonymous',
      body,
      createdAt: Date.now(),
    };
    thread.replies.push(reply);
    save();
    return send(res, 201, reply);
  }

  send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    fs.readFile(full, (err, buf) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Threads running at http://localhost:${PORT}`));
}

module.exports = server;
