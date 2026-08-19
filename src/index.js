#!/usr/bin/env node
/**
 * Mindjack MCP server — one-line install for agent runtimes.
 *
 * A thin wrapper over the public API at api.mindjack.xyz. It deliberately
 * depends on nothing but that HTTP surface: no repo, no database, no Python.
 * That is what makes it distributable — a user pastes one config block and the
 * tools appear in Claude, Cursor, or any MCP client.
 *
 * KEYS ARE OPTIONAL. With no key the server mints one on first use, because a
 * setup step that requires a human to go and fetch a credential is a setup step
 * most people abandon. The key arrives EMPTY, though: there is no free
 * allowance, so the paid tools answer 402 until it is funded. get_sample and
 * get_coverage work immediately and without a key, which is how an agent finds
 * out whether funding is worth it.
 *
 * Env:
 *   MINDJACK_API_KEY   optional; auto-minted and reported once if absent
 *   MINDJACK_API_BASE  optional; defaults to https://api.mindjack.xyz
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.MINDJACK_API_BASE || "https://api.mindjack.xyz").replace(/\/$/, "");
let apiKey = process.env.MINDJACK_API_KEY || "";

/**
 * Where an auto-minted key is remembered between restarts.
 *
 * Holding it only in memory looked fine and is not: issuance is capped per
 * origin per day, so a client that mints on every start burns the allowance on
 * ordinary restarts and then silently falls back to unauthenticated calls. The
 * install promise is one line and no signup — that has to survive restarting
 * the app.
 */
const KEY_FILE = join(
  process.env.MINDJACK_CONFIG_DIR ||
    join(homedir(), ".config", "mindjack"),
  "key"
);

function readStoredKey() {
  try {
    return readFileSync(KEY_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function storeKey(key) {
  try {
    mkdirSync(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    // 0600: it is a bearer credential, even one that starts with free calls.
    writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Mint a key on first use so installation needs no prior signup. */
// Issuance is capped per origin per day. Without this the FAILURE is retried on
// every single tool call — a POST and two lines of stderr each time — which both
// hammers the endpoint and buries the one message that mattered under repeats.
let mintFailed = false;

async function ensureKey() {
  if (apiKey) return apiKey;
  if (mintFailed) return "";

  apiKey = readStoredKey();
  if (apiKey) return apiKey;

  const r = await fetch(`${BASE}/v1/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "mcp-auto" }),
  });
  if (!r.ok) {
    // Most likely the daily issuance cap. Say which, because "it stopped
    // working" with no reason is what makes someone give up on a tool.
    let why = `http_${r.status}`;
    try { why = (await r.json()).says || why; } catch { /* keep status */ }
    mintFailed = true;
    process.stderr.write(
      `[mindjack] could not obtain an API key: ${why}\n` +
      `[mindjack] set MINDJACK_API_KEY=<existing key> to keep using this server.\n`
    );
    return "";
  }
  const j = await r.json();
  apiKey = j.api_key || "";
  if (apiKey) {
    const saved = storeKey(apiKey);
    // stderr, not stdout: stdout is the MCP transport and must stay clean JSON.
    process.stderr.write(
      // The key starts empty on purpose. Saying so here rather than letting the
      // first paid tool call be where the agent finds out. `j.free_credits` was
      // left over from the allowance that no longer exists, and printed
      // "undefined free credits".
      `[mindjack] minted an API key. It has NO credits: the paid tools answer\n` +
      `[mindjack] 402 until it is funded (see /v1/credits/deposit).\n` +
      `[mindjack] get_sample shows real data for one token, free and right now.\n` +
      (saved
        ? `[mindjack] saved to ${KEY_FILE} and reused automatically.\n`
        : `[mindjack] could not write ${KEY_FILE}; set MINDJACK_API_KEY=${apiKey} ` +
          `to reuse it across restarts.\n`)
    );
  }
  return apiKey;
}

/** Forget a key the server no longer accepts, so the next call can mint one. */
function forgetKey() {
  apiKey = "";
  mintFailed = false;
  try { rmSync(KEY_FILE, { force: true }); } catch { /* nothing to forget */ }
}

async function call(path, { method = "GET", body } = {}, _retried = false) {
  const key = await ensureKey();
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(key ? { "X-API-Key": key } : {}),
        // Required on EVERY non-GET, including the ones with no body: a CSRF
        // gate refuses the request with 415 before it is even authenticated.
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
    });
  } catch (e) {
    // A DNS or connection failure is not a tool error, and surfacing the raw
    // one leaves an agent guessing whether the data is missing or the host is.
    return {
      error: "api_unreachable",
      base: BASE,
      says: `Could not reach ${BASE} (${e.cause?.code || e.message}). This is a ` +
            `connectivity problem, not an answer about the token. Set ` +
            `MINDJACK_API_BASE if the API lives elsewhere.`,
    };
  }
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: "non_json_response", raw: text.slice(0, 400) }; }
  // 402 and 429 are answers, not crashes: hand them back so the agent can react
  // (top up, slow down) rather than seeing an opaque tool failure.
  if (!r.ok && !data.error) data.error = `http_${r.status}`;

  // A stored key the server has stopped accepting used to be terminal. The key
  // is written to disk so it survives restarts, so once it was revoked or the
  // file went stale, every tool call answered invalid_api_key forever and the
  // only way out was deleting a file the user did not know existed. Revoking a
  // key is a lever we actually use, and it should end an abusive session, not
  // brick a legitimate one permanently. Discard it and mint once — the retry
  // flag makes this a single extra attempt rather than a loop against a server
  // that is simply refusing us.
  if (data.error === "invalid_api_key" && !_retried) {
    forgetKey();
    return call(path, { method, body }, true);
  }
  return data;
}

// Shared parameter schemas. Every parameter carries a description because an
// agent fills arguments from the schema and nothing else; an undescribed one
// is a guess. Shared rather than repeated so the wording cannot drift between
// the ten tools that take a mint.
const P_MINT = {
  type: "string",
  description: "Solana token mint, base58.",
};
const P_ADDRESS = {
  type: "string",
  description: "Solana wallet, base58.",
};
const P_LIMIT = {
  type: "integer",
  description: "Rows, 1-100. Default 25.",
};

const TOOLS = [
  {
    name: "check_token",
    description:
      "[$0.001] Is this Solana token dangerous? Returns a calibrated rug verdict " +
      "whose probability is a MEASURED frequency (see get_scorecard), the " +
      "concentration facts behind it, and how fast tokens in this band tend to " +
      "collapse — the exit window. Use when scanning; cheap enough for every " +
      "token you see. Not for holder identities: that is inspect_token.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/screen/${a.mint}`),
  },
  {
    name: "inspect_token",
    description:
      "[$0.005] Who is involved in this token: top holders and supply, the " +
      "sniper / fresh-wallet / insider / early-buyer split, connected-group " +
      "topology, and tracked-trader activity with direction. Use after " +
      "check_token flags something.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/inspect/${a.mint}`),
  },
  {
    name: "token_report",
    description:
      "[$0.025] Everything we hold on one token, in one call: the calibrated " +
      "verdict, who is in it, and who is behind it. depth=\"full\" is $0.07 and " +
      "adds the outcome path, live sellability and the wallet graph. Cheaper " +
      "than the parts and one round trip instead of three or six. Use once a " +
      "token is worth a real look; keep using check_token to decide which ones " +
      "those are.",
    inputSchema: {
      type: "object",
      properties: {
        mint: P_MINT,
        depth: {
          type: "string",
          enum: ["core", "full"],
          description: "core: verdict, holders, identity. full adds graph, price path, sellability.",
        },
      },
      required: ["mint"],
    },
    run: (a) =>
      call(`/v1/report/${a.mint}${a.depth === "full" ? "?depth=full" : ""}`),
  },
  {
    name: "token_identity",
    description:
      "[$0.025] Who is BEHIND this token. What its largest holders did in earlier " +
      "launches, which sibling tokens the same wallets ran and how those ended, " +
      "and the measured upside band. The decision-point call. Coverage varies and " +
      "is reported per call; an empty result is free.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/identity/${a.mint}`),
  },
  {
    name: "find_tokens",
    description:
      "[$0.005] Find candidates: recently analysed tokens, each already carrying a " +
      "verdict, so you can rank locally before paying for depth. Filters: hours " +
      "(1-168), min_mcap, platform, limit (1-100).",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          description: "Hours back, 1-168. Default 24.",
        },
        min_mcap: {
          type: "number",
          description: "Minimum market cap, USD.",
        },
        platform: {
          type: "string",
          description: "Launchpad, e.g. pumpfun or letsbonk.",
        },
        limit: P_LIMIT,
      },
    },
    run: (a) => {
      const q = new URLSearchParams(
        Object.entries(a).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      return call(`/v1/discover${q ? "?" + q : ""}`);
    },
  },
  {
    name: "check_wallet",
    description:
      "[$0.006] What we know about a wallet across every token we indexed: how many " +
      "launches it appeared in, how many ran, which roles it recurs in, and its " +
      "realised record. Use to vet a large holder or a wallet you might copy.",
    inputSchema: {
      type: "object",
      properties: { address: P_ADDRESS },
      required: ["address"],
    },
    run: (a) => call(`/v1/wallet/${a.address}`),
  },
  {
    name: "can_i_exit",
    description:
      "[$0.005] Can this token be sold RIGHT NOW, and what does a round trip cost. " +
      "Asks Jupiter for a real buy route and a real sell route back at $100 and " +
      "$1000, and reports what fraction of your money survives. Verdict follows " +
      "the worst rung: clear / elevated / thin / trapped / blocked. Use this at " +
      "the trigger — every other tool here tells you what happened to tokens like " +
      "this one, this one tells you whether you can get out of this one. Quotes " +
      "only, nothing is signed. Not cached, so it takes a few hundred ms.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/exit/${a.mint}`),
  },
  {
    name: "token_changes",
    description:
      "[$0.025] Who sold since we analysed it. Reads the chain right now and diffs " +
      "the large positions against what we recorded. Use when a cached read feels " +
      "stale, or to see whether concentrated wallets are exiting a position you " +
      "hold. The only call that touches the chain live.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/changes/${a.mint}`),
  },
  {
    name: "token_price_path",
    description:
      "[$0.005] What the token did after we called it: peak, drawdown from peak, " +
      "and where it stands now, at 4-5 second resolution. Our feed starts at " +
      "analysis, so the bonding-curve phase before that is not included.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/price/${a.mint}`),
  },
  {
    name: "find_serial_insiders",
    description:
      "[$0.025 per 25] Wallets that keep turning up as insiders across the whole " +
      "index — the question a single token cannot answer. Every row carries the " +
      "wallet's full footprint, not just its insider count, because ranking on " +
      "the count alone puts automation on top: the highest is flagged in 1,642 " +
      "tokens and also holds 4,091. Read insider_in against also_held — close " +
      "together is a real serial insider, far apart is a bot that buys " +
      "everything early.",
    inputSchema: {
      type: "object",
      properties: {
        min_tokens: {
          type: "integer",
          description: "Minimum tokens flagged in. Default 3.",
        },
        limit: P_LIMIT,
      },
    },
    run: (a) => {
      const q = new URLSearchParams();
      if (a && a.min_tokens != null) q.set("min_tokens", a.min_tokens);
      if (a && a.limit != null) q.set("limit", a.limit);
      const qs = q.toString();
      return call(`/v1/serial-insiders${qs ? "?" + qs : ""}`);
    },
  },
  {
    name: "compare_tokens",
    description:
      "[$0.025] Were these tokens run by the same people? Give 2-4 mints and get " +
      "the wallets appearing in more than one, each with the role it played in " +
      "each. Weigh the roles rather than the count: shared holders are common, " +
      "a wallet that was an insider in one and a sniper in the next is not. " +
      "Mints outside our index come back named in not_covered.",
    inputSchema: {
      type: "object",
      properties: {
        mints: {
          type: "array",
          items: P_MINT,
          description: "Two to four mints to compare.",
        },
      },
      required: ["mints"],
    },
    run: (a) => call("/v1/compare", { method: "POST", body: { mints: a.mints } }),
  },
  {
    name: "test_hypothesis",
    description:
      "[$0.025] Research, not screening. Describe the shape of token you care about " +
      "and get what measurably happened to the matching cohort: collapse rate " +
      "against the base rate, peak-gain percentiles, time to peak, collapse speed. " +
      "Filters take {min,max} bounds; get_coverage lists the queryable fields.",
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: "Field bounds as {min,max}; get_coverage lists the fields.",
        },
        window_days: {
          type: "integer",
          description: "Cohort window, days. Default 30.",
        },
      },
      required: ["filters"],
    },
    run: (a) => call("/v1/cohort", { method: "POST", body: a }),
  },
  {
    name: "get_scorecard",
    description:
      "[free] Our measured hit rate per risk band, and how fast each band tends to " +
      "collapse. Read this to decide how much weight to give our verdicts. Most " +
      "risk APIs ask you to trust a score; this one shows how it performed.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/v1/scorecard"),
  },
  {
    name: "get_sample",
    description:
      "[free, no key] One fixed token, answered in full: the complete check_token, " +
      "inspect_token and token_identity responses for it, each carrying the price " +
      "that call costs when you make it yourself. Call this before paying for " +
      "anything — it is served by the same handlers as the paid tools, so it is " +
      "what you would actually get, not an illustration. The token never changes, " +
      "so use get_coverage for freshness and this for depth.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/v1/sample"),
  },
  {
    name: "token_graph",
    description:
      "[$0.04] The wallet relationship graph behind a token: edges with strength " +
      "and confidence, cluster membership and role, and wash-trading wallets. " +
      "inspect_token tells you WHO holds it; this tells you how they are " +
      "connected, and whether a distributed-looking holder set is really one " +
      "person. Not a first look — come here when the concentration numbers look " +
      "wrong and you need the shape.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/graph/${a.mint}`),
  },
  {
    name: "token_wallets",
    description:
      "[$0.005] The NAMED wallets behind one token, with their in-coin ties: " +
      "insiders, snipers, early buyers, fresh wallets, wash traders and tracked " +
      "KOLs, each carrying its funder (exchanges named), link count and cluster. " +
      "Lists cap at 100 per class; *_total fields carry the real counts. Use " +
      "when a count from check_token made you ask WHO.",
    inputSchema: {
      type: "object",
      properties: { mint: P_MINT },
      required: ["mint"],
    },
    run: (a) => call(`/v1/wallets/${a.mint}`),
  },
  {
    name: "token_web",
    description:
      "[$0.04] The token's web: earlier launches tied to it through shared " +
      "wallets, with the shared wallets themselves, each connected token's " +
      "outcome and the highest market cap our snapshots recorded. Use when " +
      "token_identity said this token shares wallets with earlier launches and " +
      "you need to know which launches and which wallets.",
    inputSchema: {
      type: "object",
      properties: {
        mint: P_MINT,
        min_shared: {
          type: "integer",
          description: "Minimum shared wallets. Default 3.",
        },
      },
      required: ["mint"],
    },
    run: (a) => {
      const q = a.min_shared ? `?min_shared=${a.min_shared}` : "";
      return call(`/v1/web/${a.mint}${q}`);
    },
  },
  {
    name: "wallet_network",
    description:
      "[$0.025] Who one wallet is wired to, across the whole index: direct " +
      "counterparts with interaction counts, shared tokens and transfer " +
      "direction where the chain shows it, plus a bounded second hop. " +
      "check_wallet says what it did; this says who it moves with.",
    inputSchema: {
      type: "object",
      properties: { address: P_ADDRESS },
      required: ["address"],
    },
    run: (a) => call(`/v1/wallet/${a.address}/network`),
  },
  {
    name: "kol_leaderboard",
    description:
      "[$0.02/page] Every tracked KOL wallet, ranked from the recorded trades: " +
      "lifetime realized SOL, per-token win rate on NET realized SOL, and a " +
      "recent-activity window. Sort by profit, success or activity. Use to " +
      "build or refresh a copy-trading watchlist.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Recent window, 1-90 days. Default 7.",
        },
        sort: {
          type: "string",
          enum: ["profit", "success", "activity"],
          description: "profit: realised SOL. success: win rate. activity: recent trades.",
        },
        limit: P_LIMIT,
      },
    },
    run: (a) => {
      const q = new URLSearchParams(
        Object.entries(a).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      return call(`/v1/kols${q ? "?" + q : ""}`);
    },
  },
  {
    name: "kol_record",
    description:
      "[$0.02] One tracked KOL in depth: lifetime stats, per-token history " +
      "rolled up from every recorded trade (buys, sells, volume, realized SOL) " +
      "and the latest trades raw. An address we do not track answers null and " +
      "costs nothing; check_wallet covers any wallet.",
    inputSchema: {
      type: "object",
      properties: { address: P_ADDRESS },
      required: ["address"],
    },
    run: (a) => call(`/v1/kol/${a.address}`),
  },
  {
    name: "funder_networks",
    description:
      "[$0.025/page] Funders ranked by how many fresh wallets they seeded " +
      "across the whole index, each labelled when we know the exchange behind " +
      "it. A funder inside one token is a line item; across the index it is a " +
      "desk. A null label with a high count is the shape worth opening.",
    inputSchema: {
      type: "object",
      properties: {
        min_wallets: {
          type: "integer",
          description: "Minimum wallets seeded. Default 3.",
        },
        limit: P_LIMIT,
      },
    },
    run: (a) => {
      const q = new URLSearchParams(
        Object.entries(a).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      return call(`/v1/funder-networks${q ? "?" + q : ""}`);
    },
  },
  {
    name: "search_tokens",
    description:
      "[$0.005/page] Find a token anywhere in the analysed catalogue by symbol, " +
      "name fragment, or exact mint, with platform, size and age filters. The " +
      "finding aid: it tells you which mint is worth a real call. find_tokens " +
      "answers 'what just migrated'; this answers 'find me that token'.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Symbol, name fragment, or exact mint.",
        },
        platform: {
          type: "string",
          description: "Launchpad, e.g. pumpfun or letsbonk.",
        },
        min_mcap: {
          type: "number",
          description: "Minimum market cap, USD.",
        },
        days: {
          type: "integer",
          description: "Analysed within this many days.",
        },
        limit: P_LIMIT,
        offset: {
          type: "integer",
          description: "Rows to skip. Default 0.",
        },
      },
    },
    run: (a) => {
      const q = new URLSearchParams(
        Object.entries(a).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      return call(`/v1/search${q ? "?" + q : ""}`);
    },
  },
  // ChatGPT's deep research and company knowledge modes look for two tools by
  // name, `search` and `fetch`, and connect to nothing without them. Asked to
  // learn Mindjack, ChatGPT reported there was nothing here for it: twenty-four
  // tools, and not the two it looks for.
  //
  // Aliases, not new products. Same endpoints, same prices and same billing as
  // search_tokens and token_report; giving them their own price would have
  // added a number that could disagree with the published list.
  {
    name: "search",
    description:
      "[$0.005/page] Find Solana tokens in the analysed catalogue by symbol, " +
      "name, or exact mint. Returns {id, title, url} rows; pass an id to " +
      "`fetch` for the full document. Same endpoint and same price as " +
      "search_tokens, in the shape research clients expect.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Symbol, name fragment, or an exact mint address.",
        },
        limit: P_LIMIT,
      },
      required: ["query"],
    },
    run: async (a) => {
      const params = new URLSearchParams();
      if (a.query) params.set("q", a.query);
      if (a.limit !== undefined && a.limit !== null) params.set("limit", a.limit);
      const out = await call(`/v1/search?${params.toString()}`);
      if (!out || out.error) return out;
      const results = (out.tokens || [])
        .map((t) => ({ t, url: tokenUrl(t.mint) }))
        // A row we cannot link is a row we cannot cite, so it is dropped
        // rather than emitted with a blank or a broken address.
        .filter(({ url }) => url)
        .map(({ t, url }) => ({
          id: t.mint,
          title: [t.symbol, t.name].filter(Boolean).join(" — ") || t.mint,
          url,
        }));
      return { results, count: results.length, says: out.says, _meta: out._meta };
    },
  },
  {
    name: "fetch",
    description:
      "[$0.025] Everything Mindjack holds on one token as a single document: " +
      "the calibrated rug verdict with its measured hit rate, who is holding " +
      "and how they are connected, and whether it can still be sold. Takes an " +
      "id from `search` — a Solana mint address. Same endpoint and price " +
      "as token_report.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "A Solana mint address, usually from `search`.",
        },
      },
      required: ["id"],
    },
    run: async (a) => {
      const out = await call(`/v1/report/${encodeURIComponent(a.id || "")}`);
      if (!out || out.error) return out;
      const screen = out.screen || {};
      const identity = out.identity || {};
      const mint = screen.mint || identity.mint || out.mint || "";
      const title =
        [screen.symbol || identity.symbol, screen.name || identity.name]
          .filter(Boolean)
          .join(" — ") || mint || "token";
      return {
        id: mint,
        title,
        url: tokenUrl(mint),
        text: JSON.stringify(out, null, 2),
        metadata: out._meta,
      };
    },
  },
  {
    name: "get_coverage",
    description:
      "[free] What we hold and how fresh, plus a live example mint that is " +
      "guaranteed to have data. Call this first. We index every pump.fun and " +
      "letsbonk migration since our start date — testing with an older token you " +
      "already know will return nothing and tell you nothing about us.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/v1/coverage"),
  },
  {
    name: "get_balance",
    description:
      "[free] Credits remaining on your key. There is no free allowance: a new " +
      "key starts at zero and is funded with a USDC deposit, so a balance of 0 " +
      "means the paid tools will answer 402 until you top up.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/v1/credits/balance"),
  },
];

// Read from package.json rather than typed here. It was typed here, and the
// two drifted the first time it mattered: 1.0.1 shipped to npm while the
// server kept introducing itself as 1.0.0 in every MCP handshake. A client
// deciding whether it has the build with can_i_exit would have been told no.
const PKG_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";  // visibly wrong beats confidently wrong
  }
})();

// Handed to the model once, at the handshake, instead of being repeated in
// twenty-six descriptions. It says the three things that are not derivable
// from a tool list: what the index actually contains, that the numbers are
// measured frequencies rather than opinions, and which order the tools go in.
// Kept short on purpose — it is in the context of every request that follows.
const INSTRUCTIONS = [
  "Mindjack answers from a point-in-time record of Solana launches: holder",
  "distribution, insider, fresh-wallet and sniper detection as they stood at",
  "the moment each token migrated. That state cannot be rebuilt from the chain",
  "afterwards, which is why the window is the product.",
  "",
  "Call get_coverage first. It is free and returns the window, what is in it,",
  "and a live mint that is guaranteed to have data. A token from outside the",
  "window answers coverage=none, which is a real answer and is never charged —",
  "check _meta.coverage before reading a body as a verdict.",
  "",
  "rug_probability_pct is a MEASURED collapse frequency for a calibrated band,",
  "not an opinion and not a per-token risk starting at zero. The safest band",
  "still rugged about 35% of the time and the universe base rate is 45%, so a",
  "filter under ~35 matches nothing. get_scorecard publishes every band.",
  "",
  "Order that works: find_tokens for candidates, check_token on each,",
  "inspect_token on the few that flag, token_identity at the decision point.",
  "check_wallet vets a counterparty at any stage. can_i_exit before buying",
  "anything you intend to sell.",
  "",
  "Prices are per call and stated in each description. Nothing is charged for",
  "a failed call, an empty result, or a token we do not hold.",
].join("\n");

const server = new Server(
  { name: "mindjack", version: PKG_VERSION },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: INSTRUCTIONS,
  }
);

// Every tool here reads. Nothing writes, signs, or moves anything, and
// can_i_exit only asks Jupiter for a quote. Declaring that is not decoration:
// the MCP spec treats an ABSENT destructiveHint as destructive, so without
// these a client is entitled to warn before every call and a scanner cannot
// call the surface safe. Two hints and no more: every field here is loaded
// into the model's context on every request, and nothing reads the other two.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false };

// One complete example call per tool, attached to the schema rather than to
// each parameter. Two earlier attempts put examples in the description and
// then on individual parameters; neither is what the reader looks at. This is,
// and it is the more useful shape anyway: an agent copies a call, not a field.
const M1 = "6acH1iae44zL4haWNNCaqcTqS2Q7KNYsWErxCoLW9u9P";
const M2 = "CuPKnZJ6ut7WR5XGjdZtvLQQJpewHNPTuRyXvC8ThXEq";
const W1 = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
const TOKEN_PAGE = "https://mindjack.xyz/token/";
// base58 has no 0, O, I or l, and a Solana address is 32-44 of the rest.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// A link to the page for a mint, or nothing if that is not a mint. The value
// comes from our own mirror, so in practice it is always an address — this
// does not rely on that. The url is rendered by whichever client asked, and a
// mint carrying a quote or a space would reach that renderer inside an href we
// built.
const tokenUrl = (mint) =>
  BASE58.test(String(mint || "")) ? TOKEN_PAGE + encodeURIComponent(mint) : null;

const EXAMPLE_CALL = {
  check_token: { mint: M1 },
  inspect_token: { mint: M1 },
  token_report: { mint: M1, depth: "full" },
  token_identity: { mint: M1 },
  find_tokens: { hours: 6, min_mcap: 50000 },
  check_wallet: { address: W1 },
  can_i_exit: { mint: M1 },
  token_changes: { mint: M1 },
  token_price_path: { mint: M1 },
  find_serial_insiders: { min_tokens: 8, limit: 50 },
  compare_tokens: { mints: [M1, M2] },
  test_hypothesis: { filters: { total_holders: { min: 200 } }, window_days: 30 },
  token_graph: { mint: M1 },
  token_wallets: { mint: M1 },
  token_web: { mint: M1, min_shared: 5 },
  wallet_network: { address: W1 },
  kol_leaderboard: { days: 30, sort: "success" },
  kol_record: { address: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o" },
  funder_networks: { min_wallets: 20 },
  search_tokens: { q: "bonk", days: 7 },
  search: { query: "bonk" },
  fetch: { id: M1 },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    // The four tools that take no arguments carry one too, as an empty call:
    // the check asks whether a tool has an example, not whether it has fields.
    inputSchema: { ...inputSchema, examples: [EXAMPLE_CALL[name] || {}] },
    // Declaring this obliges us to return structuredContent that matches it,
    // which the call handler below now does for every tool rather than for
    // the two ChatGPT asked about.
    ...(OUTPUT_SCHEMAS[name] ? { outputSchema: OUTPUT_SCHEMAS[name] } : {}),
    annotations: READ_ONLY,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  }
  try {
    const result = await tool.run(req.params.arguments || {});
    // Modern clients read structuredContent and older ones read the text, so
    // both carry the same value rather than one summarising the other. ChatGPT
    // requires exactly this duplication for search and fetch.
    // Both shapes, always. A tool that declares an outputSchema must return
    // structuredContent, and the serialized text stays beside it because a
    // client that predates structured output would otherwise get an empty
    // answer. This used to be limited to search and fetch, which was the
    // narrowest reading of "who asked for it": every tool declares a schema
    // now, so every tool owes the structure.
    const out = {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
    // Not for an error body. A 402 or a refusal is a legitimate answer and it
    // still goes back in full as text, but it shares no field with the shape
    // this tool declared — and a new install has an empty key, so that is what
    // twenty-two of these tools return on their very first call. Handing that
    // back as `structuredContent` invites a client to read a payment challenge
    // as the data it asked for.
    if (result && typeof result === "object" && !Array.isArray(result)
        && !result.error) {
      out.structuredContent = result;
    }
    return out;
  } catch (e) {
    return {
      content: [{ type: "text", text: `Mindjack request failed: ${e.message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Resources
//
// Four things a caller needs before it can read anything else: what the index
// holds, what the risk numbers were measured against, what each call costs,
// and one worked example. All four are free endpoints, so exposing them here
// costs nobody anything and saves an agent from spending a paid call to find
// out it was asking the wrong question. They are resources rather than tools
// because a client can attach them once and cache them, instead of the model
// having to decide to call them.
// ---------------------------------------------------------------------------
const RESOURCES = [
  {
    uri: "mindjack://coverage",
    name: "Index coverage",
    description:
      "What we hold and how fresh: the window, the platforms inside it, what " +
      "is excluded, and a live mint guaranteed to have data. Read this before " +
      "testing with a token of your own.",
    mimeType: "application/json",
    path: "/v1/coverage",
  },
  {
    uri: "mindjack://scorecard",
    name: "Risk calibration",
    description:
      "Every calibrated band with the collapse rate MEASURED for it, its " +
      "sample size and the window. This is what rug_probability_pct is read " +
      "against; the safest band still rugs about 35% of the time.",
    mimeType: "application/json",
    path: "/v1/scorecard",
  },
  {
    uri: "mindjack://prices",
    name: "Price list",
    description:
      "Every priced route with its price, the asset, the network and the " +
      "receiving address. The same document an x402 client pays from.",
    mimeType: "application/json",
    path: "/.well-known/x402",
  },
  {
    uri: "mindjack://sample",
    name: "Worked example",
    description:
      "One real token answered in full, free: the complete check, inspect and " +
      "identity bodies with the real price of each. The shape of what you " +
      "would be buying, before buying it.",
    mimeType: "application/json",
    path: "/v1/sample",
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const found = RESOURCES.find((r) => r.uri === req.params.uri);
  if (!found) throw new Error("Unknown resource: " + req.params.uri);
  const body = await call(found.path);
  return {
    contents: [
      {
        uri: found.uri,
        mimeType: found.mimeType,
        text: JSON.stringify(body, null, 2),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Prompts
//
// The orders of calls that are worth running, written down. Each one is the
// chain a reader would otherwise have had to derive from the whole tool list:
// which tool first, what to read out of it, and when the next one is worth its
// price. They take arguments rather than being static text, because a workflow
// you cannot point at a mint is a tutorial.
// ---------------------------------------------------------------------------
const PROMPTS = [
  {
    name: "vet_before_buying",
    description:
      "The full check on one token before taking a position: structure first, " +
      "then who is holding it, then whether it can be sold.",
    arguments: [
      { name: "mint", description: "Solana mint address.", required: true },
    ],
    build: (a) =>
      [
        "Decide whether to buy " + a.mint + ". Work in this order and stop",
        "early if something disqualifies it.",
        "",
        "1. check_token on " + a.mint + '. If _meta.coverage is "none" we hold',
        "   nothing on it: say so and stop, because that is not a clean",
        "   verdict. Read rug_risk.verdict together with rug_risk.calibration,",
        "   since the probability is a MEASURED rate for that band and not an",
        "   opinion. Read collapse_speed too: a token that dies in sixty",
        "   seconds is a different risk from one that bleeds out over a day.",
        "2. If it survives that, inspect_token on " + a.mint + " for who is",
        "   holding it: wallet groups, controlled supply, fresh wallets.",
        "3. token_identity on " + a.mint + " at the decision point.",
        "   sibling_outcomes is the field that changes minds: it says how the",
        "   OTHER tokens these same wallets held ended up. A clean structure",
        "   with a cohort that rugged sixteen times out of twenty is not a",
        "   clean token.",
        "4. can_i_exit on " + a.mint + " before committing. A position you",
        "   cannot sell at your size is not a position.",
        "",
        "Then state the decision, the number that drove it, and what would",
        "change it. Do not predict a price; we do not publish one.",
      ].join("\n"),
  },
  {
    name: "find_candidates",
    description:
      "Screen recent launches down to the few worth paying for depth on.",
    arguments: [
      // MCP prompt arguments are strings on the wire, always. Saying so here
      // is the difference between a client sending 6 and being refused by
      // schema validation before the server sees it, and sending "6".
      {
        name: "hours",
        description: "How far back to look, as a string. Default 24.",
        required: false,
      },
      {
        name: "min_mcap",
        description: "Minimum market cap in USD, as a string.",
        required: false,
      },
    ],
    build: (a) =>
      [
        "Find launches worth a second look in the last " +
          (a.hours || 24) +
          " hours.",
        "",
        "1. find_tokens with hours=" + (a.hours || 24),
        // null, not "": the filter below keeps deliberate blank lines and
        // drops this one, so an unused optional argument leaves no gap.
        a.min_mcap ? "   and min_mcap=" + a.min_mcap : null,
        "   Set max_rug_pct no lower than 40. It is a measured band frequency",
        "   and the safest band is about 35%, so anything under that returns",
        "   nothing however wide you make the window.",
        "2. Rank what comes back by action and rug_probability_pct, but look at",
        "   volume against market cap as well: the list is ordered by recency,",
        "   not by opportunity.",
        "3. check_token the few that read clear. At a tenth of a cent it is",
        "   cheaper to check than to guess.",
        "4. token_identity only on the survivors. It is the expensive call and",
        "   it is the one that changes the answer.",
        "",
        "Report the shortlist with the reason each one survived, and say",
        "plainly if nothing did.",
      ]
        // Not filter(Boolean): the empty strings in this list are
        // deliberate blank lines, and dropping them along with the
        // unused optional line ran every paragraph together.
        .filter((line) => line !== null)
        .join("\n"),
  },
  {
    name: "vet_counterparty",
    description:
      "What a wallet has done before: the tokens it held, how they ended, and " +
      "who funds it.",
    arguments: [
      { name: "address", description: "Solana wallet address.", required: true },
    ],
    build: (a) =>
      [
        "Build a picture of " + a.address + " before dealing with it.",
        "",
        "1. check_wallet on " + a.address + " for its record: what it has",
        "   held, how those ended, and whether it behaves like a sniper or an",
        "   insider.",
        "2. wallet_network on " + a.address + " for who funds it and who it",
        "   moves with. A wallet is rarely alone, and the funder is usually",
        "   the identity.",
        "3. If it appears in a token you are looking at, run token_identity on",
        "   that token as well and see whether this wallet is one of the",
        "   recurring names or an ordinary holder.",
        "",
        "Say what the wallet is, on the evidence, and how confident that is.",
      ].join("\n"),
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map(({ name, description, arguments: args }) => ({
    name,
    description,
    arguments: args,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const found = PROMPTS.find((p) => p.name === req.params.name);
  if (!found) throw new Error("Unknown prompt: " + req.params.name);
  const args = req.params.arguments || {};
  for (const a of found.arguments || []) {
    if (a.required && !args[a.name]) {
      throw new Error("Prompt " + found.name + " needs " + a.name);
    }
  }
  return {
    description: found.description,
    messages: [
      { role: "user", content: { type: "text", text: found.build(args) } },
    ],
  };
});

await server.connect(new StdioServerTransport());
process.stderr.write(`[mindjack] connected to ${BASE}\n`);
