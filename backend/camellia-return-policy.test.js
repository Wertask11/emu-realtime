const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReturn } = require('../frontend/public/camellia-return-policy.js');
test('Camellia Passport return accepts only the two named HTTPS app roots', () => {
  for (const origin of ['https://camellia-beta.vercel.app', 'https://camellia-beta-git-feat-camellia-v1-release-audit-school-park.vercel.app']) {
    assert.equal(validateReturn(origin + '/').href, origin + '/');
  }
  for (const value of [null, '', '/','https://evil.example/', 'http://camellia-beta.vercel.app/', 'https://camellia-beta.vercel.app.evil.example/', 'https://evil.example/?return=https://camellia-beta.vercel.app/', 'https://user:password@camellia-beta.vercel.app/', 'https://camellia-beta.vercel.app:444/', 'https://camellia-beta.vercel.app/path', 'https://camellia-beta.vercel.app/?next=evil', 'https://camellia-beta.vercel.app/#evil', 'https://camellia-beta-git-other-school-park.vercel.app/', ' https://camellia-beta.vercel.app/']) {
    assert.equal(validateReturn(value), null, String(value));
  }
});
