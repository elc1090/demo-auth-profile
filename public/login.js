import { getSession, api } from './api.js';
const form = document.querySelector('form'), message = document.querySelector('#message');
let mode = 'register';
function setMode(next) {
  mode = next;
  document.querySelector('#registerTab').setAttribute('aria-pressed', mode === 'register');
  document.querySelector('#loginTab').setAttribute('aria-pressed', mode === 'login');
  document.querySelector('#submit').textContent = mode === 'register' ? 'Criar conta' : 'Entrar';
  document.querySelector('#password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  message.textContent = '';
}
document.querySelector('#registerTab').onclick = () => setMode('register');
document.querySelector('#loginTab').onclick = () => setMode('login');
const errors = { 'google-disabled': 'Configure o Google no arquivo .env.', 'google-state': 'Login expirou ou a sessão mudou. Tente novamente.',
  'google-cancelled': 'Login com Google cancelado.', 'google-failed': 'Não foi possível entrar com Google. Confira a configuração no README.' };
message.textContent = errors[new URLSearchParams(location.search).get('error')] || '';
history.replaceState(null, '', '/');
try {
  const session = await getSession();
  if (session.user) location.replace('/profile.html');
  if (!session.googleEnabled) {
    document.querySelector('#google').setAttribute('aria-disabled', 'true');
    document.querySelector('#google').removeAttribute('href');
    document.querySelector('#googleHint').hidden = false;
  }
} catch (error) { message.textContent = error.message; }
form.onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector('#submit'); button.disabled = true;
  try { await api(`/api/${mode}`, 'POST', Object.fromEntries(new FormData(form))); location.assign('/profile.html'); }
  catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
};
