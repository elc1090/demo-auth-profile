import { getSession, api } from './api.js';
const form = document.querySelector('form'), message = document.querySelector('#message');
try {
  const session = await getSession();
  if (!session.user) location.replace('/');
  else {
    const user = await api('/api/profile', 'GET');
    document.querySelector('#identity').textContent = user.email;
    document.querySelector('#provider').textContent = user.provider === 'google' ? 'Autenticação: Google' : 'Autenticação: e-mail e senha';
    for (const key of ['name', 'course', 'city', 'interests', 'bio']) form.elements[key].value = user[key];
    document.querySelector('#profileCard').hidden = false;
  }
} catch (error) { message.textContent = error.message; }
form.onsubmit = async event => {
  event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
  try { await api('/api/profile', 'PUT', Object.fromEntries(new FormData(form))); message.textContent = 'Perfil salvo!'; }
  catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
};
document.querySelector('#logout').onclick = async () => {
  try { await api('/api/logout', 'POST'); location.assign('/'); }
  catch (error) { message.textContent = error.message; }
};
