import { lookup } from "node:dns/promises";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import ipaddr from "ipaddr.js";
export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}
export async function validatePublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.replace(/^webcal:/, "https:"));
  } catch {
    throw new Error("Enter a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Only public HTTPS URLs are supported.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("The URL must point to a public calendar service.");
  return { url, address: addresses[0] };
}
export async function requestPublic(
  raw: string,
  token?: string,
  redirects = 0,
  deadline = Date.now() + 45_000,
): Promise<{ text: string; headers: IncomingHttpHeaders }> {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new Error("The remote service timed out. Try again.");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const { url, address } = await Promise.race([
    validatePublicUrl(raw),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("The remote service timed out. Try again.")),
        remaining,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
  const result = await new Promise<{
    text: string;
    headers: IncomingHttpHeaders;
    status: number;
  }>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/json, text/calendar;q=0.9",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        family: address.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        timeout: Math.min(15_000, Math.max(1, deadline - Date.now())),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            response.destroy();
            request.destroy(
              new Error("The remote response exceeds the 2 MB limit."),
            );
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 500,
          }),
        );
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("The remote service timed out. Try again.")),
    );
    request.on("error", () =>
      reject(
        new Error(
          "Unable to reach the remote service. Check your connection and URL.",
        ),
      ),
    );
  });
  if (result.status >= 300 && result.status < 400 && result.headers.location) {
    if (redirects >= 3)
      throw new Error("Too many redirects from the remote service.");
    const destination = new URL(result.headers.location, url);
    if (token && destination.origin !== url.origin)
      throw new Error(
        "Canvas redirected to another domain. Check your domain.",
      );
    return requestPublic(
      destination.toString(),
      token,
      redirects + 1,
      deadline,
    );
  }
  if (result.status === 401 || result.status === 403)
    throw new Error(
      "Canvas rejected the token. Check its permissions and expiration.",
    );
  if (result.status < 200 || result.status >= 300)
    throw new Error(
      `The remote service returned HTTP ${result.status}. Check your URL and try again.`,
    );
  return result;
}
