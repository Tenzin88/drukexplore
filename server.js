// DrukExplore backend: Express (API) + Socket.IO (real-time chat) + SQLite (database)
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { answer } = require('./rag');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync(process.env.DB_PATH || 'drukexplore.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, senderId INTEGER NOT NULL, senderName TEXT NOT NULL, message TEXT NOT NULL, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS destinations(id TEXT PRIMARY KEY, name TEXT, tagline TEXT, region TEXT, experience TEXT, location TEXT, bestTime TEXT, attractions TEXT, description TEXT);
`);
// Seed destinations table from the knowledge base on every start
const upsert = db.prepare('INSERT OR REPLACE INTO destinations VALUES (@id,@name,@tagline,@region,@experience,@location,@bestTime,@attractions,@description)');
for (const d of require('./knowledge-base/destinations.json')) upsert.run({ ...d, attractions: JSON.stringify(d.attractions) });

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const signToken = (u) => jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
}

// ---------- Auth ----------
app.post('/api/auth/signup', (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  if (name.trim().length < 2 || name.length > 50) return res.status(400).json({ error: 'Name must be 2-50 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: 'Password needs 8+ characters with a letter and a number.' });
  try {
    db.prepare('INSERT INTO users(name,email,hash) VALUES(?,?,?)').run(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10));
    res.status(201).json({ message: 'Account created successfully!' });
  } catch { res.status(409).json({ error: 'An account with this email already exists.' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.hash)) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ token: signToken(u), user: { id: u.id, name: u.name } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,name,email,createdAt FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Please sign in to continue.' });
  u.messageCount = db.prepare('SELECT COUNT(*) c FROM messages WHERE senderId=?').get(u.id).c;
  res.json({ user: u });
});

// ---------- Destinations ----------
const parseDest = (d) => ({ ...d, attractions: JSON.parse(d.attractions) });
app.get('/api/destinations', (_req, res) => res.json(db.prepare('SELECT * FROM destinations').all().map(parseDest)));
app.get('/api/destinations/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM destinations WHERE id=?').get(req.params.id);
  d ? res.json(parseDest(d)) : res.status(404).json({ error: 'Destination not found.' });
});

// ---------- Chat history (new messages travel over Socket.IO) ----------
app.get('/api/chat/messages', auth, (_req, res) =>
  res.json(db.prepare('SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 100) ORDER BY id').all()));

// ---------- RAG assistant ----------
app.post('/api/ai/ask', auth, async (req, res) => {
  const q = (req.body.question || '').trim();
  if (!q || q.length > 300) return res.status(400).json({ error: 'Please enter a question (max 300 characters).' });
  try { res.json(await answer(q)); }
  catch (e) { console.error(e); res.status(502).json({ error: 'The AI assistant is temporarily unavailable.' }); }
});

// ---------- Real-time chat ----------
io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});
io.on('connection', (socket) => {
  io.emit('online', io.engine.clientsCount);
  socket.on('message', (text, ack) => {
    const message = String(text || '').trim();
    if (!message || message.length > 500) return ack && ack({ error: 'Message must be 1-500 characters.' });
    const msg = { senderId: socket.user.id, senderName: socket.user.name, message, timestamp: new Date().toISOString() };
    msg.id = db.prepare('INSERT INTO messages(senderId,senderName,message,timestamp) VALUES(?,?,?,?)')
      .run(msg.senderId, msg.senderName, msg.message, msg.timestamp).lastInsertRowid;
    io.emit('message', msg); // broadcast to ALL connected users
    ack && ack({ ok: true });
  });
  socket.on('disconnect', () => io.emit('online', io.engine.clientsCount));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DrukExplore running on http://localhost:${PORT}`));
