import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export async function publicWebUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!host.includes(".") || /\.(localhost|local|internal|lan|test|invalid)$/.test(host)) return false;
  try {
    const addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !blocked.check(address, isIP(address) === 4 ? "ipv4" : "ipv6"));
  } catch { return false; }
}

export async function installPublicWebGuard(context) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (await publicWebUrl(url)) await route.continue();
    else await route.abort("blockedbyclient");
  });
}
