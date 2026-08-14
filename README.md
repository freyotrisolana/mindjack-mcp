# @mindjack/mcp

On-chain risk and identity intelligence for Solana tokens, as MCP tools.

## Install

Add to your MCP client config — Claude Desktop, Cursor, Codex, or anything else
that speaks MCP:

```json
{
  "mcpServers": {
    "mindjack": {
      "command": "npx",
      "args": ["-y", "@mindjack/mcp"]
    }
  }
}
```

That is the whole setup. No signup, no card: the server mints a key on first
use, saves it to `~/.config/mindjack/key`, and reuses it from then on. A new
key starts empty — fund it with a USDC deposit when you are ready; the free
tools below work before you fund anything, and `get_sample` answers one real
token in full so you can see every paid tier before spending a cent.

Set `MINDJACK_API_KEY` to use a specific key instead, or `MINDJACK_CONFIG_DIR`
to keep it somewhere else.

Prefer to skip keys entirely? The API also speaks
[x402](https://x402.org) — pay per call in USDC on Solana, no account at all.

## Tools

| Tool | Price | Answers |
|---|---|---|
| `get_sample` | free | One fixed token, answered in full — no key, no payment |
| `get_coverage` | free | What we hold, how fresh, and a mint that works |
| `get_scorecard` | free | Our measured hit rate per risk band |
| `get_balance` | free | What is left on your key |
| `check_token` | $0.001 | Is this one dangerous, and how fast do these collapse |
| `find_tokens` | $0.005 | Which tokens are worth looking at, verdicts attached |
| `search_tokens` | $0.005 /page | Find any token we ever analysed, by symbol, name or mint |
| `inspect_token` | $0.005 | Who is holding it, and what kind of wallets |
| `token_wallets` | $0.005 | The named wallets behind it: insiders, snipers, fresh, wash, KOLs — with funders and clusters |
| `token_price_path` | $0.005 | What it did after we called it |
| `can_i_exit` | $0.005 | Can it be sold right now — a live Jupiter round trip at $100 and $1000 |
| `check_wallet` | $0.006 | Who is this wallet, across every token we indexed |
| `kol_leaderboard` | $0.02 /page | Every tracked KOL ranked: realized SOL, win rate, recent window |
| `kol_record` | $0.02 | One KOL's full record: per-token history and latest trades |
| `token_identity` | $0.025 | Who is behind it, and how their earlier tokens ended |
| `token_report` | $0.025 | Everything on one token in one call; `depth: "full"` is $0.07 |
| `token_changes` | $0.025 | Who sold since we analysed it (reads the chain now) |
| `test_hypothesis` | $0.025 | What happened to tokens shaped like this |
| `find_serial_insiders` | $0.025 / 25 | Who keeps turning up as an insider, across the whole index |
| `compare_tokens` | $0.025 | Were these 2-4 tokens run by the same people |
| `wallet_network` | $0.025 | Who a wallet moves with: counterparts, direction, second hop |
| `funder_networks` | $0.025 /page | Funders seeding fresh wallets index-wide, exchanges named |
| `token_graph` | $0.04 | How the holders are connected: edges, clusters, wash wallets |
| `token_web` | $0.04 | Launches tied to this one through shared wallets, with outcomes and peaks |

Live feeds (new launches, watched wallets, KOL trades) are server-sent event
streams and do not map to MCP tools — the endpoint guide below covers them.

## What makes this different

**We keep outcomes.** Most APIs describe a token as it looks right now. We also
know what happened to every launch we have indexed since March 2026 — tens of
thousands of them — which is why `check_token` can tell you that tokens scoring
like this one collapsed 78% of the time rather than just handing you a number.

**We publish our hit rate.** `get_scorecard` returns the measured accuracy of
every band, refreshed weekly. Nobody who does not keep labelled outcomes can
produce that, and you should not trust a risk score from anyone who won't.

**Collapse speed, not just collapse probability.** In this market almost
everything eventually dies, so "will it" separates weakly. "How fast" separates
about tenfold — the worst band's median collapse is 19 seconds from peak, the
cleanest is 11 minutes. That is the number that decides whether a position is
exitable at all.

**Wallets have a past.** Millions of recorded wallet appearances. When the same wallets
show up in a new launch, `token_identity` tells you where else they have been
and how those ended.

## Honest limits

- **Solana only**, and only tokens indexed at migration. We hold every pump.fun
  and letsbonk migration since our start date — complete inside that window,
  nothing before it. The record is point-in-time and cannot be rebuilt later.
- **We do not predict price.** Where upside is reported it is a measured
  historical frequency for a cohort, not a forecast, and not adjusted for fees
  or slippage.
- **Unknown tokens, failed calls and empty results cost nothing.** Every
  response carries `_meta.coverage` and `_meta.billing` so you can see exactly
  what you got and what it cost.

## Links

- API: <https://api.mindjack.xyz>
- Endpoint guide an LLM can read in one fetch: <https://api.mindjack.xyz/llms.txt>
- OpenAPI: <https://api.mindjack.xyz/v1/openapi.json>
