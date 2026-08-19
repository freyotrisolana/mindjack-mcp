// Pre-publish gate: a real MCP handshake over stdio, then live API calls.
//
// It runs inside the publish workflow before `npm publish`, so anything it
// refuses never reaches the registry. That only works if it actually refuses:
// this used to print "EKSIK" for a missing tool and exit 0 anyway, which is a
// gate that reports rather than one that stops. Every check now sets the exit
// code, and the workflow stops on it.
//
// Run: MINDJACK_API_KEY=mj_live_... node test-release.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const child = spawn(process.execPath, ["src/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg); pending.delete(msg.id);
      }
    } catch {}
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + " timeout")); } }, 30000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log("  ok    " + label + (detail ? "  [" + detail + "]" : ""));
  } else {
    failures++;
    console.log("  FAIL  " + label + (detail ? "  [" + detail + "]" : ""));
  }
}

// The revision we intend to speak. A client asking for this must not be
// answered with an older one: half of what is declared below only exists in
// the newer schema.
const PROTOCOL = "2025-11-25";
const NEW_TOOLS = ["token_wallets", "token_web", "wallet_network",
                   "kol_leaderboard", "kol_record", "funder_networks",
                   "search_tokens"];
const RESOURCES = ["mindjack://coverage", "mindjack://scorecard",
                   "mindjack://prices", "mindjack://sample"];
const PROMPTS = ["vet_before_buying", "find_candidates", "vet_counterparty"];

try {
  // What is about to be published, as bytes, before anything is launched.
  // The bin entry runs through its shebang on macOS and Linux, and this
  // package is authored on Windows: a CRLF checkout turns
  // "#!/usr/bin/env node" into a request for an interpreter literally named
  // "node\\r", and a byte-order mark ahead of the "#!" hides it from the
  // kernel entirely. Neither failure can happen on the machine that made the
  // file, so it has to be checked on the machine that ships it.
  console.log("\nThe bytes being shipped");
  const raw = readFileSync(new URL("./src/index.js", import.meta.url));
  check("the bin entry has no byte-order mark",
        !(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf));
  const firstLine = raw.subarray(0, 64).toString("utf8").split("\n")[0];
  check("it starts with a node shebang",
        firstLine === "#!/usr/bin/env node", JSON.stringify(firstLine));
  const hasCrlf = raw.toString("utf8").includes("\r\n");
  check("and carries unix line endings", !hasCrlf,
        hasCrlf ? "CRLF found; the shebang will not resolve on Linux" : "");

  console.log("\nHandshake");
  const init = await rpc("initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "release-test", version: "0" },
  });
  const r = init.result || {};
  check("server identifies itself", !!r.serverInfo?.name,
        r.serverInfo?.name + " " + r.serverInfo?.version);
  check("negotiates the current revision", r.protocolVersion === PROTOCOL,
        String(r.protocolVersion));
  check("declares tools", !!r.capabilities?.tools);
  check("declares resources", !!r.capabilities?.resources);
  check("declares prompts", !!r.capabilities?.prompts);
  // Instructions are handed to the model once instead of being repeated in
  // every description. Empty is worse than absent: it declares the field and
  // says nothing.
  check("carries server instructions", (r.instructions || "").length > 200,
        (r.instructions || "").length + " chars");
  notify("notifications/initialized", {});

  console.log("\nTools");
  const list = await rpc("tools/list", {});
  const tools = list.result?.tools || [];
  const names = tools.map((t) => t.name);
  check("tools are listed", names.length >= 26, names.length + " tools");
  const missing = NEW_TOOLS.filter((n) => !names.includes(n));
  check("the recent tools are all present", missing.length === 0, String(missing));
  const badInput = tools.filter((t) => !t.inputSchema || t.inputSchema.type !== "object");
  check("every input schema is an object", badInput.length === 0,
        badInput.map((t) => t.name).join(","));
  // Declared output shapes are half of what a scanner reads and all of what a
  // caller plans a chain of calls against.
  const noOutput = tools.filter((t) => !t.outputSchema);
  check("every tool declares an output schema", noOutput.length === 0,
        noOutput.map((t) => t.name).join(","));
  const badOutput = tools.filter(
    (t) => t.outputSchema && (t.outputSchema.type !== "object" || !t.outputSchema.properties));
  check("every output schema is a described object", badOutput.length === 0,
        badOutput.map((t) => t.name).join(","));
  const noExample = tools.filter((t) => !Array.isArray(t.inputSchema?.examples));
  check("every tool carries an example call", noExample.length === 0,
        noExample.map((t) => t.name).join(","));
  // ChatGPT's research modes connect to nothing without these two names.
  const forChatGpt = ["search", "fetch"].filter((n) => !names.includes(n));
  check("the two ChatGPT names exist", forChatGpt.length === 0, String(forChatGpt));

  console.log("\nResources");
  const res = await rpc("resources/list", {});
  const uris = (res.result?.resources || []).map((x) => x.uri);
  check("resources are listed", uris.length === RESOURCES.length, uris.length + "");
  check("the expected resources are there",
        RESOURCES.every((u) => uris.includes(u)), uris.join(" "));
  const read = await rpc("resources/read", { uri: "mindjack://scorecard" });
  const text = read.result?.contents?.[0]?.text || "";
  check("a resource reads back real content", text.length > 200,
        text.length + " bytes");
  let bands = null;
  try { bands = JSON.parse(text).bands; } catch {}
  check("and it is the calibration, parsed", Array.isArray(bands),
        Array.isArray(bands) ? bands.length + " bands" : "unparseable");

  console.log("\nPrompts");
  const pl = await rpc("prompts/list", {});
  const pnames = (pl.result?.prompts || []).map((x) => x.name);
  check("prompts are listed", pnames.length === PROMPTS.length, pnames.join(" "));
  check("the expected prompts are there",
        PROMPTS.every((n) => pnames.includes(n)), pnames.join(" "));
  const got = await rpc("prompts/get", {
    name: "vet_before_buying",
    arguments: { mint: "So11111111111111111111111111111111111111112" },
  });
  const body = got.result?.messages?.[0]?.content?.text || "";
  check("a prompt builds a message", body.length > 200, body.length + " chars");
  check("and it is about the mint it was given",
        body.includes("So11111111111111111111111111111111111111112"));

  console.log("\nLive calls");
  async function callTool(name, args) {
    const out = await rpc("tools/call", { name, arguments: args });
    const result = out.result || {};
    const txt = result.content?.[0]?.text || "";
    let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 120) }; }
    return { result, parsed };
  }

  // A tool that declares an output schema owes structuredContent. This was
  // limited to search and fetch when only those two declared one.
  const cov = await callTool("get_coverage", {});
  check("a free call answers", !!cov.parsed.index,
        cov.parsed.index ? "tokens=" + cov.parsed.index.tokens_indexed : "no index");
  check("and returns both shapes",
        !!cov.result.structuredContent && Array.isArray(cov.result.content));
  const score = await callTool("get_scorecard", {});
  check("the scorecard answers with both shapes",
        !!score.result.structuredContent && Array.isArray(score.parsed.bands),
        Array.isArray(score.parsed.bands) ? score.parsed.bands.length + " bands" : "?");
  // ChatGPT will not connect to a search that answers without
  // structuredContent — but a search that could not be paid for has nothing
  // to put there, and running this gate without a funded key is the norm. The
  // free calls above already prove the mechanism; this proves search uses it
  // when it has an answer.
  const sr = await callTool("search", { query: "bonk" });
  if (sr.parsed.error) {
    check("search could not be paid for, so it returns the reason only",
          !sr.result.structuredContent && Array.isArray(sr.result.content),
          sr.parsed.error);
  } else {
    check("search returns both shapes",
          !!sr.result.structuredContent && Array.isArray(sr.result.content));
  }

  // Paid tools answer 402 without credits, which is a correct answer and not a
  // failure: what matters is that the body explains itself rather than being a
  // bare code. Whether it is 402 or data depends on the key this runs with.
  const paid = await callTool("search_tokens", { q: "bonk", limit: 1 });
  const paidOk = Array.isArray(paid.parsed.tokens) || !!paid.parsed.says;
  check("a paid tool answers usefully with or without credits", paidOk,
        paid.parsed.error || (paid.parsed.tokens?.length + " rows"));
  // An error body shares no field with the shape the tool declared, and an
  // empty key is the state a fresh install starts in, so this is the common
  // case and not the edge one. The text still carries the whole answer.
  if (paid.parsed.error) {
    check("and an error body is not passed off as the declared structure",
          !paid.result.structuredContent, "structuredContent was set");
  } else {
    check("and a successful paid answer carries the structure",
          !!paid.result.structuredContent);
  }
} catch (e) {
  console.error("\nERROR: " + e.message);
  failures++;
} finally {
  child.kill();
}

console.log("\n" + (failures ? failures + " check(s) failed — not publishable"
                             : "all checks passed"));
process.exitCode = failures ? 1 : 0;
