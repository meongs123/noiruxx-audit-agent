// noiruxx audit agent — GET /api/audit?contract=0x...&tokenId=123
// Preliminary automated checks for a BSC ERC-721 contract, read straight
// from the chain + Sourcify. Free, no API key, no dependencies.
// This is a PRELIMINARY screen, not a full audit: it reads public on-chain
// facts and scores them against the public rubric the agent uses every day.
// It cannot see off-chain promises, and it cannot prove a contract is safe.

export const BSC_RPCS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
  "https://bsc.publicnode.com",
];
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ZERO = "0x0000000000000000000000000000000000000000";

const SEL = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  totalSupply: "0x18160ddd",
  maxSupply: "0xd5abeb01",
  owner: "0x8da5cb5b",
};

function isAddress(a) { return /^0x[0-9a-fA-F]{40}$/.test(a || ""); }

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let lastErr = null;
  for (const rpcUrl of BSC_RPCS) {
    try {
      const r = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.error) { lastErr = new Error(j.error.message || "rpc error"); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all BSC RPCs failed");
}

async function ethCall(to, data) {
  try {
    const out = await rpc("eth_call", [{ to, data }, "latest"]);
    if (typeof out !== "string" || out === "0x" || out.length < 10) return null;
    return out.toLowerCase();
  } catch { return null; }
}

function decodeString(hex) {
  try {
    if (!hex || hex.length < 130) return null;
    const len = parseInt(hex.slice(66, 130), 16);
    if (len <= 0 || len > 512) return null;
    const bytes = Buffer.from(hex.slice(130, 130 + len * 2), "hex");
    return bytes.toString("utf8").replace(/\0/g, "").trim() || null;
  } catch { return null; }
}

function decodeUint(hex) {
  try { return hex ? BigInt(hex) : null; } catch { return null; }
}

function decodeAddress(hex) {
  if (!hex || !/^0x[0-9a-f]{64}$/.test(hex)) return null;
  return "0x" + hex.slice(-40);
}

async function sourcifyStatus(address) {
  try {
    const r = await fetch(
      `https://sourcify.dev/server/v2/contract/56/${address}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.status === 404) return "false";
    if (!r.ok) return "unknown";
    const j = await r.json();
    if (j.match === "exact_match") return "perfect";
    if (j.match === "partial_match") return "partial";
    return "unknown";
  } catch { return "unknown"; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    const host = req.headers["host"] || "localhost";
    const url = new URL(req.url, `https://${host}`);
    const contract = (url.searchParams.get("contract") || "").toLowerCase();
    const tokenId = url.searchParams.get("tokenId") || "";
    if (!isAddress(contract)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "usage: /api/audit?contract=0x...&tokenId=123 (tokenId optional)" }));
      return;
    }
    if (tokenId && !/^\d+$/.test(tokenId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "tokenId must be a non-negative integer" }));
      return;
    }

    const [code, implSlot, nameHex, symbolHex, totalHex, maxHex, ownerHex, srcStatus] = await Promise.all([
      rpc("eth_getCode", [contract, "latest"]).catch(() => "0x"),
      rpc("eth_getStorageAt", [contract, EIP1967_IMPL_SLOT, "latest"]).catch(() => "0x" + "0".repeat(64)),
      ethCall(contract, SEL.name),
      ethCall(contract, SEL.symbol),
      ethCall(contract, SEL.totalSupply),
      ethCall(contract, SEL.maxSupply),
      ethCall(contract, SEL.owner),
      sourcifyStatus(contract),
    ]);

    const hasCode = typeof code === "string" && code.length > 4;
    const impl = decodeAddress(implSlot);
    const isProxy = !!impl && impl !== ZERO;
    const name = decodeString(nameHex);
    const symbol = decodeString(symbolHex);
    const totalSupply = decodeUint(totalHex);
    const maxSupply = decodeUint(maxHex);
    const owner = decodeAddress(ownerHex);
    const ownerRenounced = owner === ZERO;

    let tokenOwner = null;
    if (tokenId) {
      const data = "0x6352211e" + BigInt(tokenId).toString(16).padStart(64, "0");
      tokenOwner = decodeAddress(await ethCall(contract, data));
    }

    // --- scoring (preliminary, transparent; aligned to the agent's public rubric) ---
    const checks = [];
    let earned = 0, applicable = 0;
    const add = (label, points, ok, detail, applies = true) => {
      if (!applies) { checks.push({ label, points, status: "not-checked", detail }); return; }
      applicable += points;
      if (ok) earned += points;
      checks.push({ label, points, status: ok ? "pass" : "fail", detail });
    };

    add("Source verified (Sourcify)", 25,
      srcStatus === "perfect" || srcStatus === "partial",
      srcStatus === "perfect" ? "exact match" : srcStatus === "partial" ? "partial match" : srcStatus === "false" ? "no verified source" : "verification status unknown");
    add("ERC-721 interface responds", 15,
      hasCode && name !== null && totalSupply !== null,
      hasCode ? (name ? `name=${name} symbol=${symbol || "?"} totalSupply=${totalSupply === null ? "?" : totalSupply.toString()}` : "name()/totalSupply() did not respond — may not be ERC-721") : "no code at this address");
    add("Supply bounded", 15,
      maxSupply !== null && maxSupply > 0n && (totalSupply === null || totalSupply <= maxSupply),
      maxSupply !== null ? `maxSupply=${maxSupply.toString()} totalSupply=${totalSupply === null ? "?" : totalSupply.toString()}` : "no maxSupply() — supply uncapped or not exposed");
    add("Not an upgradeable proxy", 15,
      !isProxy,
      isProxy ? `EIP-1967 implementation=${impl} — upgrade authority exists` : "no EIP-1967 implementation slot set");
    add("No live owner", 15,
      ownerRenounced,
      owner === null ? "owner() not exposed" : ownerRenounced ? "owner is 0x0 (renounced)" : `live owner=${owner}`);
    add("Token exists (ownerOf)", 15,
      tokenOwner !== null,
      tokenOwner ? `token #${tokenId} owned by ${tokenOwner}` : `ownerOf(${tokenId}) reverted — token may not exist`,
      !!tokenId);

    let pct = applicable ? Math.round((earned / applicable) * 100) : 0;
    // Hard cap: unverified source + upgradeable proxy = at most 40, like the rubric.
    const hardCap = (srcStatus === "false" || srcStatus === "unknown") && isProxy;
    if (hardCap && pct > 40) pct = 40;
    const verdict = pct >= 75 && !hardCap
      ? "PASS — preliminary screen only"
      : "FAIL — does not clear the 75/100 bar on this preliminary screen";

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agent: "noiruxx audit agent",
      contract, chain: "BNB Smart Chain (56)",
      tokenId: tokenId || null,
      facts: { hasCode, name, symbol, totalSupply: totalSupply?.toString() ?? null, maxSupply: maxSupply?.toString() ?? null, owner, isProxy, implementation: isProxy ? impl : null, sourceVerified: srcStatus, tokenOwner },
      checks,
      score: { earned, applicable, pct, hardCapApplied: hardCap },
      verdict,
      disclaimer: "Preliminary automated screen from public on-chain reads + Sourcify. It cannot see off-chain promises, mint/transfer rules hidden in unverified bytecode, or drain functions. Not financial advice; a full audit reads the source.",
      sources: { rpc: "public BSC endpoints", verification: "sourcify.dev" },
    }));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "audit lookup failed", detail: String(e?.message || e) }));
  }
}
