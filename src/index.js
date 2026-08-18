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
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
  examples: ["6acH1iae44zL4haWNNCaqcTqS2Q7KNYsWErxCoLW9u9P"],
};
const P_ADDRESS = {
  type: "string",
  description: "Solana wallet, base58.",
  examples: ["bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa"],
};
const P_LIMIT = {
  type: "integer",
  description: "Rows, 1-100. Default 25.",
  examples: [25],
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
          examples: ["full"],
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
          examples: [6],
        },
        min_mcap: {
          type: "number",
          description: "Minimum market cap, USD.",
          examples: [50000],
        },
        platform: {
          type: "string",
          description: "Launchpad, e.g. pumpfun or letsbonk.",
          examples: ["pumpfun"],
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
          examples: [8],
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
          examples: [["6acH1iae44zL4haWNNCaqcTqS2Q7KNYsWErxCoLW9u9P",
                      "CuPKnZJ6ut7WR5XGjdZtvLQQJpewHNPTuRyXvC8ThXEq"]],
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
          examples: [{ total_holders: { min: 200 } }],
        },
        window_days: {
          type: "integer",
          description: "Cohort window, days. Default 30.",
          examples: [30],
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
          examples: [5],
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
          examples: [30],
        },
        sort: {
          type: "string",
          enum: ["profit", "success", "activity"],
          description: "profit: realised SOL. success: win rate. activity: recent trades.",
          examples: ["success"],
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
          examples: [20],
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
          examples: ["bonk"],
        },
        platform: {
          type: "string",
          description: "Launchpad, e.g. pumpfun or letsbonk.",
          examples: ["pumpfun"],
        },
        min_mcap: {
          type: "number",
          description: "Minimum market cap, USD.",
          examples: [50000],
        },
        days: {
          type: "integer",
          description: "Analysed within this many days.",
          examples: [7],
        },
        limit: P_LIMIT,
        offset: {
          type: "integer",
          description: "Rows to skip. Default 0.",
          examples: [50],
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

const server = new Server(
  { name: "mindjack", version: PKG_VERSION },
  { capabilities: { tools: {} } }
);

// Every tool here reads. Nothing writes, signs, or moves anything, and
// can_i_exit only asks Jupiter for a quote. Declaring that is not decoration:
// the MCP spec treats an ABSENT destructiveHint as destructive, so without
// these a client is entitled to warn before every call and a scanner cannot
// call the surface safe. Two hints and no more: every field here is loaded
// into the model's context on every request, and nothing reads the other two.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Mindjack request failed: ${e.message}` }],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write(`[mindjack] connected to ${BASE}\n`);
