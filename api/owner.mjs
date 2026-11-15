// noiruxx audit agent — GET /api/owner?contract=0x...&tokenId=123
// Free on-chain ownerOf lookup for one BSC ERC-721 NFT. No key, no deps.

export const BSC_RPCS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
  "https://bsc.publicnode.com",
];

function isAddress(a) { return /^0x[0-9a-fA-F]{40}$/.test(a || ""); }

async function ownerOf(contract, tokenId) {
  const data = "0x6352211e" + BigInt(tokenId).toString(16).padStart(64, "0");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data }, "latest"] });
  let lastErr = null;
  for (const rpc of BSC_RPCS) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.error) { lastErr = new Error(j.error.message || "rpc error"); continue; }
      const out = (j.result || "").toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(out)) { lastErr = new Error("unexpected ownerOf return"); continue; }
      return "0x" + out.slice(-40);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all BSC RPCs failed");
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
    if (!isAddress(contract) || !/^\d+$/.test(tokenId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "usage: /api/owner?contract=0x...&tokenId=123" }));
      return;
    }
    const owner = await ownerOf(contract, tokenId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ contract, tokenId, owner, chain: "BNB Smart Chain (56)" }));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "BSC lookup failed (contract may not be ERC-721, or RPC unreachable)", detail: String(e?.message || e) }));
  }
}
