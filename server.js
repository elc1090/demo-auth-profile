import express from 'express';
import session from 'express-session';
import { OAuth2Client } from 'google-auth-library';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const random = () => randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 3000);
// A URL pública é configuração do servidor, nunca um Host enviado pelo cliente.
const appUrl = (process.env.APP_URL || (process.env.CODESPACE_NAME
  ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`
  : `http://localhost:${port}`)).replace(/\/$/, '');
const secure = new URL(appUrl).protocol === 'https:';
const callbackUrl = `${appUrl}/auth/google/callback`;
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, callbackUrl);
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(`${dataDir}/demo.sqlite`);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL,
 google_sub TEXT UNIQUE, password_hash TEXT, name TEXT NOT NULL DEFAULT '',
 course TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
 interests TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
 UNIQUE(provider, email)
);`);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(session({
  name: 'demo.sid', secret: process.env.SESSION_SECRET || random(),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure, sameSite: 'lax', maxAge: 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  // Todos os POST/PUT exigem um token associado à sessão, inclusive login.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!req.session.csrf || req.get('X-CSRF-Token') !== req.session.csrf)) {
    return res.status(403).json({ error: 'Sessão inválida. Recarregue a página.' });
  }
  next();
});
const publicUser = u => ({ id: u.id, provider: u.provider, email: u.email, name: u.name,
  course: u.course, city: u.city, interests: u.interests, bio: u.bio });
const currentUser = req => db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId || -1);
const requireUser = (req, res, next) => currentUser(req) ? next() : res.status(401).json({ error: 'Entre para acessar seu perfil.' });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
const save = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
async function signIn(req, userId) {
  await regenerate(req); // Evita reutilizar a sessão anterior ao login.
  req.session.userId = userId;
  req.session.csrf = random();
  await save(req);
}
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
// Limite simples por sessão para a aula; produção exige limite persistente por IP/conta.
function limitAttempts(req, res, next) {
  const now = Date.now();
  if (!req.session.attempts || now - req.session.attempts.start > 60000) req.session.attempts = { start: now, count: 0 };
  if (++req.session.attempts.count > 10) return res.status(429).json({ error: 'Aguarde um minuto antes de tentar novamente.' });
  next();
}
app.get('/api/session', (req, res) => {
  req.session.csrf ||= random();
  const user = currentUser(req);
  res.json({ csrf: req.session.csrf, googleEnabled, user: user ? publicUser(user) : null });
});
app.post('/api/register', limitAttempts, asyncRoute(async (req, res) => {
  const email = emailOf(req.body.email), password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'Informe um e-mail válido e uma senha de 8 a 128 caracteres.' });
  if (db.prepare("SELECT id FROM users WHERE provider='local' AND email=?").get(email))
    return res.status(409).json({ error: 'Já existe uma conta local com esse e-mail. Use Entrar.' });
  const salt = random();
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  let result;
  try { result = db.prepare("INSERT INTO users(provider,email,password_hash) VALUES ('local',?,?)").run(email, `${salt}:${hash}`); }
  catch (e) { if (e.code?.includes('CONSTRAINT')) return res.status(409).json({ error: 'Conta já cadastrada.' }); throw e; }
  await signIn(req, Number(result.lastInsertRowid));
  res.status(201).json({ ok: true });
}));
app.post('/api/login', limitAttempts, asyncRoute(async (req, res) => {
  const email = emailOf(req.body.email), password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length > 128)
    return res.status(400).json({ error: 'Credenciais inválidas.' });
  const user = db.prepare("SELECT * FROM users WHERE provider='local' AND email=?").get(email);
  const [salt, expected] = (user?.password_hash || `${'0'.repeat(64)}:${'0'.repeat(128)}`).split(':');
  const actual = await scrypt(password, salt, 64);
  if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex')))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await signIn(req, user.id);
  res.json({ ok: true });
}));
app.get('/auth/google', asyncRoute(async (req, res) => {
  if (!googleEnabled) return res.redirect('/?error=google-disabled');
  const state = random(), nonce = random();
  req.session.oauth = { state, nonce, created: Date.now() };
  await save(req);
  res.redirect(google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account' }));
}));
app.get('/auth/google/callback', asyncRoute(async (req, res) => {
  const pending = req.session.oauth;
  delete req.session.oauth;
  await save(req);
  if (!googleEnabled || !pending || typeof req.query.state !== 'string' || req.query.state !== pending.state ||
      Date.now() - pending.created > 10 * 60 * 1000) return res.redirect('/?error=google-state');
  if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/?error=google-cancelled');
  try {
    // O código é trocado por tokens pelo BACKEND; o secret nunca vai ao navegador.
    const { tokens } = await google.getToken(req.query.code);
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified || identity.nonce !== pending.nonce) throw new Error('Invalid identity');
    let user = db.prepare('SELECT * FROM users WHERE google_sub=?').get(identity.sub);
    if (!user) {
      const result = db.prepare("INSERT INTO users(provider,email,google_sub,name) VALUES ('google',?,?,?)")
        .run(emailOf(identity.email), identity.sub, (identity.name || '').slice(0, 80));
      user = { id: Number(result.lastInsertRowid) };
    }
    await signIn(req, user.id);
    return res.redirect('/profile.html');
  } catch {
    // Não registrar códigos, tokens, senhas ou respostas completas do provedor.
    console.error('Falha no login Google. Confira credenciais, callback e conectividade.');
    return res.redirect('/?error=google-failed');
  }
}));
app.get('/api/profile', requireUser, (req, res) => res.json(publicUser(currentUser(req))));
app.put('/api/profile', requireUser, (req, res) => {
  const limits = { name: 80, course: 100, city: 100, interests: 200, bio: 500 };
  const data = {};
  for (const [key, max] of Object.entries(limits)) {
    if (typeof req.body[key] !== 'string' || req.body[key].trim().length > max)
      return res.status(400).json({ error: `Campo ${key} inválido (máximo ${max} caracteres).` });
    data[key] = req.body[key].trim();
  }
  if (!data.name || !data.course || !data.city) return res.status(400).json({ error: 'Preencha nome, curso/área e cidade.' });
  // A identidade vem da sessão: o cliente não escolhe qual usuário atualizar.
  db.prepare('UPDATE users SET name=?,course=?,city=?,interests=?,bio=? WHERE id=?')
    .run(data.name, data.course, data.city, data.interests, data.bio, req.session.userId);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res, next) => req.session.destroy(error => {
  if (error) return next(error);
  res.clearCookie('demo.sid', { httpOnly: true, secure, sameSite: 'lax' });
  res.json({ ok: true });
}));
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  console.error('Erro interno:', err.code || err.name);
  res.status(500).json({ error: 'Não foi possível concluir a operação.' });
});
app.listen(port, '0.0.0.0', () => {
  console.log(`Aplicação: ${appUrl}\nCallback Google: ${callbackUrl}\nGoogle: ${googleEnabled ? 'configurado' : 'desativado — preencha .env'}`);
});
