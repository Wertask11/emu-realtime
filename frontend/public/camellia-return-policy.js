(function (root) {
  'use strict';
  const origins = new Set([
    'https://camellia-beta.vercel.app',
    'https://camellia-beta-git-feat-camellia-v1-release-audit-school-park.vercel.app',
  ]);
  function validateReturn(value) {
    if (typeof value !== 'string' || value !== value.trim()) return null;
    try {
      const url = new URL(value);
      if (!origins.has(url.origin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return url;
    } catch (_) { return null; }
  }
  const policy = { validateReturn };
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.CamelliaReturnPolicy = policy;
})(typeof window === 'undefined' ? globalThis : window);
