import "server-only";

import { lookup as dnsLookup } from "dns";
import https from "https";
import { BlockList, isIP, type LookupFunction } from "net";

// SSRF-safe HTTPS GET for Client ID Metadata Documents (BYT-20261117-001 §2).
//   - https only, default port only, no credentials in the URL
//   - every resolved address is checked AT CONNECT TIME (custom `lookup`),
//     so DNS rebinding between "check" and "connect" is impossible
//   - private / loopback / link-local / CGNAT / multicast / reserved /
//     documentation ranges are refused (v4, v6, v4-mapped v6)
//   - 5 s total timeout, 64 KB body cap, redirects are NOT followed

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

// Two lists on purpose: in one shared BlockList the IPv6 rule ::ffff:0:0/96
// also matches every plain IPv4 address, so all public IPv4 hosts were
// refused. v4-mapped v6 addresses are unwrapped and checked against v4 below.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96], // v4-mapped — checked separately against the v4 list
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return !blockedV4.check(mapped[1], "ipv4");
    return !blockedV6.check(address, "ipv6");
  }
  return false;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
      return callback(
        Object.assign(new Error("blocked_address"), { code: "EBLOCKED" }),
        "",
        4
      );
    }
    if ((options as { all?: boolean }).all) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (callback as any)(null, list);
    }
    return callback(null, list[0].address, list[0].family);
  });
};

export class SafeFetchError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SafeFetchError";
  }
}

/** Validates that `raw` is a fetchable public https URL (no IP literals to private ranges). */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("invalid_url");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("https_required");
  if (url.username || url.password) throw new SafeFetchError("credentials_in_url");
  if (url.port && url.port !== "443") throw new SafeFetchError("port_not_allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new SafeFetchError("blocked_address");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new SafeFetchError("blocked_address");
  }
  return url;
}

/** GET a small JSON document over HTTPS with the SSRF guards above. */
export function safeFetchJson(raw: string): Promise<unknown> {
  const url = assertFetchableUrl(raw);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "open-resiapp-mcp/1 (+cimd)",
        },
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.resume();
          reject(new SafeFetchError(status >= 300 && status < 400 ? "redirect_refused" : `http_${status}`));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new SafeFetchError("too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new SafeFetchError("invalid_json"));
          }
        });
        res.on("error", (err) => reject(err));
      }
    );
    const timer = setTimeout(() => req.destroy(new SafeFetchError("timeout")), TIMEOUT_MS);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof SafeFetchError ? err : new SafeFetchError("fetch_failed"));
    });
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new SafeFetchError("timeout")));
    req.end();
  });
}
