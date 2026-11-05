// Test runner only; does not alter the application or use a live wallet.
const { chromium } = require('playwright');
const launch = chromium.launch.bind(chromium);
chromium.launch = options => launch({
  ...options,
  executablePath: '/usr/bin/chromium',
  args: [...(options?.args || []), '--no-sandbox']
});
