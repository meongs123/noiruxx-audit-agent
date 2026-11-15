// Local dev wrapper only — Vercel uses api/*.mjs directly.
import http from "node:http";
import audit from "./api/audit.mjs";
import owner from "./api/owner.mjs";
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url.startsWith("/api/audit") || req.url.startsWith("/audit")) return audit(req, res);
  if (req.url.startsWith("/api/owner") || req.url.startsWith("/owner")) return owner(req, res);
  res.writeHead(404); res.end("not found");
}).listen(port, () => console.log(`noiruxx-audit-agent on http://localhost:${port}`));
