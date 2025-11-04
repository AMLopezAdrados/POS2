const API_BASE = window.API_BASE_URL || '/api';

export function getToken() {
  try {
    return localStorage.getItem('authToken');
  } catch {
    return null;
  }
}

export async function apiFetch(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = path.startsWith('/') ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
  const response = await fetch(url, { cache: 'no-cache', ...options, headers });
  if (response.status === 401 || response.status === 403) {
    try { localStorage.removeItem('authToken'); } catch {}
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  return response;
}

export { API_BASE };
