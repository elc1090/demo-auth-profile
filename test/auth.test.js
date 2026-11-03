import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('autenticação, autorização e persistência do perfil', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-demo-'));
  const port = 19000 + Math.floor(Math.random() * 10000);
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, APP_URL: base, SESSION_SECRET: 'test-secret', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { const exit = once(child, 'exit'); child.kill(); await exit; rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    child.stdout.on('data', d => { if (String(d).includes('Aplicação:')) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  function client() {
    let cookie = '', csrf = '';
    return {
      async request(path, method = 'GET', body, withCsrf = true) {
        const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
        if (withCsrf) headers['X-CSRF-Token'] = csrf;
        const response = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
        const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
        const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
        if (data.csrf) csrf = data.csrf;
        return { status: response.status, data, location: response.headers.get('location') };
      }
    };
  }
  const a = client(), b = client();
  assert.equal((await a.request('/api/profile')).status, 401);
  assert.equal((await a.request('/api/session')).data.googleEnabled, false);
  const credentials = { email: 'ana@example.com', password: 'senha-de-teste' };
  assert.equal((await a.request('/api/register', 'POST', credentials, false)).status, 403);
  assert.equal((await a.request('/api/register', 'POST', credentials)).status, 201);
  assert.equal((await a.request('/api/session')).data.user.email, credentials.email);
  const profile = { name: 'Ana', course: 'Computação', city: 'Santa Maria', interests: 'Web', bio: 'Teste' };
  assert.equal((await a.request('/api/profile', 'PUT', { ...profile, name: '' })).status, 400);
  assert.equal((await a.request('/api/profile', 'PUT', profile)).status, 200);
  assert.equal((await a.request('/api/profile')).data.city, profile.city);
  await b.request('/api/session');
  assert.equal((await b.request('/api/register', 'POST', { email: 'bia@example.com', password: 'outra-senha' })).status, 201);
  await b.request('/api/session');
  assert.equal((await b.request('/api/profile')).data.city, '');
  await b.request('/api/profile', 'PUT', { ...profile, name: 'Bia', userId: 1 });
  assert.equal((await a.request('/api/profile')).data.name, 'Ana');
  assert.equal((await b.request('/api/profile')).data.name, 'Bia');
  assert.equal((await a.request('/api/logout', 'POST')).status, 200);
  assert.equal((await a.request('/api/profile')).status, 401);
  await a.request('/api/session');
  assert.equal((await a.request('/api/login', 'POST', { ...credentials, password: 'incorreta' })).status, 401);
  assert.equal((await a.request('/api/login', 'POST', credentials)).status, 200);
  await a.request('/api/session');
  assert.equal((await a.request('/api/profile')).data.bio, profile.bio);
  const callback = await a.request('/auth/google/callback?code=fake&state=fake');
  assert.equal(callback.location, '/?error=google-state');
  assert.equal((await a.request('/api/profile')).data.name, 'Ana');
});
