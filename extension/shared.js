// Pure helpers, shared by the service worker and tests.
export const DESK = 'https://kemdirimakujuobi.github.io/kems-list/desk/';

// Captured details travel after '#', which browsers never send to any server.
export const deskUrl = (details) => `${DESK}#add=${encodeURIComponent(JSON.stringify(details))}`;

// Permission is requested one site at a time, only when adding a *link* to a page you haven't opened.
export function originPattern(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}/*` : null;
  } catch { return null; }
}
