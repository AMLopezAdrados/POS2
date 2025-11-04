// 📦 0_storage.js
/**
 * Sla ingelogde gebruiker op in localStorage, of bij falen in een cookie.
 * Cookie leeft 30 dagen.
 */
export function saveUser(user) {
  try {
    localStorage.setItem('gebruiker', JSON.stringify(user));
  } catch (e) {
    // fallback: cookie
    const v = encodeURIComponent(JSON.stringify(user));
    document.cookie = `gebruiker=${v}; path=/; max-age=${60*60*24*30}`;
  }
}

/**
 * Haal ingelogde gebruiker op: eerst localStorage, anders cookie.
 */
export function getUser() {
  try {
    const data = localStorage.getItem('gebruiker');
    if (data) return JSON.parse(data);
  } catch (_) {}
  // fallback cookie
  const match = document.cookie.match('(?:^|; )gebruiker=([^;]*)');
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch (_) {}
  }
  return null;
}
