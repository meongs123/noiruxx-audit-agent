# noiruxx audit agent

**A preliminary screen for BSC NFT contracts — read from the chain, not from a dashboard.**

Free-mint hunters lose money to contracts that look free and turn out drainable,
upgradeable, or uncapped. This agent answers one question before anyone mints:
*what does the contract itself actually say?* It reads the contract on BNB Smart
Chain, checks source verification on Sourcify, and scores the facts against a
public rubric. No API key, no signup, no wallet connect.

Live demo: https://noiruxx-audit-agent.vercel.app

## Problem

A "free" NFT mint is only free if the contract is honest. Dashboards say "Free"
and "Verified" whether or not the chain agrees. The operator of this agent
(noiruxx.ai, a BSC free-mint hunter) audits every candidate contract by hand
before any mint — source verification, proxy/upgrade authority, supply caps,
live owner, transfer rules — and scores it against a public 100-point rubric
with a hard cap of 40 for drainable escrow + blocked transfers. This agent
packages the first, mechanical half of that audit as a public API anyone can
call in one request.

## Endpoints

### `GET /api/audit?contract=0x...&tokenId=123`

Preliminary audit screen. `tokenId` is optional.

Returns facts (`name`, `symbol`, `totalSupply`, `maxSupply`, `owner`,
`isProxy`, implementation address, Sourcify status, `tokenOwner`), per-check
scores, and a verdict:

```json
{
  "contract": "0xd088...",
  "chain": "BNB Smart Chain (56)",
  "facts": { "name": "Pocket Moons", "totalSupply": "2382", "maxSupply": "5555", "sourceVerified": "perfect", "isProxy": false },
  "checks": [ { "label": "Source verified (Sourcify)", "points": 25, "status": "pass", "detail": "exact match" } ],
  "score": { "earned": 100, "applicable": 100, "pct": 100, "hardCapApplied": false },
  "verdict": "PASS — preliminary screen only"
}
```

### `GET /api/owner?contract=0x...&tokenId=123`

On-chain owner of one BSC ERC-721 token (`ownerOf`).

## How it works

1. **Read the chain.** `eth_call` against public BSC RPCs
   (`bsc-dataseed.binance.org`, `bsc-dataseed1.binance.org`,
   `bsc.publicnode.com`, with fallback): `name()`, `symbol()`,
   `totalSupply()`, `maxSupply()`, `owner()`, `ownerOf(tokenId)`.
   `eth_getCode` plus the EIP-1967 implementation slot
   (`0x3608…82bbc`) tell whether the contract is an upgradeable proxy.
2. **Check verification.** Sourcify's check-by-addresses API reports exact
   match, partial match, or no verified source.
3. **Score transparently.** 25 points for verified source, 15 each for
   ERC-721 interface responding, bounded supply, no upgradeable proxy, no
   live owner, and token existence. Unverified source + upgradeable proxy
   caps the score at 40 — the same hard cap the operator's rubric uses.
   Verdict: pass at 75/100 or higher.

Key decisions:

- **No dependencies, plain Node `fetch`.** Nothing to audit in the agent
  itself; the whole service is two small files.
- **Reads only, never signs.** The agent holds no keys and cannot move
  funds. It can only report what the chain says.
- **Honest limits in every response.** The reply carries a disclaimer:
  this is a preliminary screen, not a full audit. It cannot see off-chain
  promises, mint/transfer rules hidden in unverified bytecode, or drain
  functions. A passing screen means "look closer", a failing screen means
  "stop".

## Try it

- Pocket Moons #2380 (free mint claimed by the operator):
  `/api/audit?contract=0xd088e5aa3c9b15d129846488e9ae5712ce7bf6b6&tokenId=2380`
- Binanceminer BinerCard #3655:
  `/api/audit?contract=0x5e6ec40E540cf9231fedE1E27144fEE252CbE205&tokenId=3655`
- HATCHIEggy #1632 (unverified source — see what the screen says):
  `/api/audit?contract=0xF2a6D1A5Da92d611cf8eC614548D4d6E83BEB6D8&tokenId=1632`

## Local dev

```bash
node server.mjs   # http://localhost:3000
```

## Deploy

```bash
vercel deploy --scope noiru --project noiruxx-audit-agent --prod
```

## zkVerify angle (optional)

The agent's claims are on-chain reads, so they are checkable by anyone
replaying the same `eth_call`s — no proof is attached, and none is needed
for the screen to be verifiable. A zkVerify proof would become useful the
moment the agent starts asserting off-chain facts (e.g. "this dashboard
said free at time T") — that is a future direction, not a claim made here.

## License

MIT
