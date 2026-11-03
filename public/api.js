let csrf;
export async function getSession() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Não foi possível carregar a sessão.');
  const session = await response.json(); csrf = session.csrf; return session;
}
export async function api(path, method, body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Operação não concluída.');
  return data;
}
