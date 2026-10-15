"use strict";
const https = require("node:https");
const agent = new https.Agent({ keepAlive: true, maxSockets: 4, family: 4 });
const TIMEOUT = 6000,
  MAX_RESPONSE = 100000;

// Anonymous safety probes only, never model/API credentials or user content.
function nativeProbe(url, options = {}, request = https.request) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.hostname !== "firestore.googleapis.com" ||
    target.username ||
    target.password ||
    target.port ||
    target.search
  )
    return Promise.reject(
      Object.assign(Error("INVALID_PROBE_DESTINATION"), {
        code: "INVALID_PROBE_DESTINATION",
      }),
    );
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: options.method || "GET",
        headers: { Accept: "application/json", ...options.headers },
        agent,
        family: 4,
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE) {
            req.destroy(
              Object.assign(Error("PROBE_RESPONSE_LIMIT"), {
                code: "PROBE_RESPONSE_LIMIT",
              }),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", (e) => {
          clearTimeout(deadline);
          reject(e);
        });
        response.on("end", () => {
          clearTimeout(deadline);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: {
                "Content-Type":
                  response.headers["content-type"] || "application/json",
              },
            }),
          );
        });
      },
    );
    const deadline = setTimeout(
      () =>
        req.destroy(
          Object.assign(Error("PROBE_TIMEOUT"), { name: "TimeoutError" }),
        ),
      TIMEOUT,
    );
    req.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}
function createProbeTransport({ env = process.env, fetcher, requester } = {}) {
  const proxied = () =>
    ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].some(
      (name) => env[name] || process.env[name],
    );
  const modeFor = (url) =>
    new URL(url).protocol === "http:"
      ? "emulator-fetch"
      : proxied()
        ? "proxy-fetch"
        : "ipv4-https";
  const transport = (url, options = {}) => {
    // Keep the inherited proxy/CA path whenever configured. Emulator traffic also
    // keeps the ordinary fetch path. Only direct production probes prefer IPv4.
    if (modeFor(url) !== "ipv4-https")
      return (fetcher || globalThis.fetch)(url, {
        ...options,
        signal: AbortSignal.timeout(TIMEOUT),
      });
    return nativeProbe(url, options, requester);
  };
  transport.modeFor = modeFor;
  return transport;
}
async function boundedChecks(values, concurrency, check) {
  const results = values.map(() => false);
  let next = 0,
    failed = false;
  async function worker() {
    while (!failed && next < values.length) {
      const i = next++;
      try {
        results[i] = await check(values[i]);
        if (!results[i]) failed = true;
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}
module.exports = {
  createProbeTransport,
  nativeProbe,
  boundedChecks,
  TIMEOUT,
  MAX_RESPONSE,
};
