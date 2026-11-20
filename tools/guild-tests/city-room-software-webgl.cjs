"use strict";
// Environment profile only: existing SwiftShader tests retain every assertion and
// CSS viewport size; use 0.75 device pixel ratio for rasterization on this CPU.
const Module = require("node:module"),
  load = Module._load,
  seen = new WeakSet();
Module._load = function (...args) {
  const r = load.apply(this, args);
  if (
    /playwright/.test(String(args[0])) &&
    r?.chromium &&
    !seen.has(r.chromium)
  ) {
    const c = r.chromium,
      launch = c.launch.bind(c);
    seen.add(c);
    c.launch = async (options = {}) => {
      const software = (options.args || []).some(
          (a) => a === "--use-angle=swiftshader",
        ),
        b = await launch({
          ...options,
          executablePath: "/usr/bin/chromium",
          args: [
            ...(options.args || []),
            "--no-sandbox",
            "--disable-dev-shm-usage",
          ],
        });
      if (software) {
        for (const name of ["newContext", "newPage"]) {
          const create = b[name].bind(b);
          b[name] = (o = {}) =>
            create({ ...o, deviceScaleFactor: o.deviceScaleFactor ?? 0.75 });
        }
      }
      return b;
    };
  }
  return r;
};
