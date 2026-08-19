/**
 * What each tool returns, as JSON Schema.
 *
 * A tool that declares an outputSchema must return structuredContent matching
 * it, so these are a promise and not documentation: a client is entitled to
 * validate against them and to plan a chain of calls from the field names
 * without spending a call to discover the shape.
 *
 * NOT written by hand. Every priced route states its own outputSchema in the
 * 402 challenge, which costs nothing to read, and the free routes answer 200,
 * so these were harvested from the API that owns them and then reduced to the
 * top level. Hand-copied schemas would have become a second contract that
 * drifts from the first one quietly; regenerate rather than edit.
 *
 * Reduced deliberately. The full server schemas are 22KB and the tool list is
 * already 16KB, all of it loaded into the model's context on every request.
 * The top-level names and types are what a caller plans against; the nested
 * structure is discoverable from the response it just paid for.
 */
export const OUTPUT_SCHEMAS = {
  check_token: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "facts": {
        "type": "object",
        "description": "Counts AND the share of supply behind each: snipers, insiders, fresh wallets, wallet groups,..."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "name": {
        "type": "string"
      },
      "rug_risk": {
        "type": "object"
      },
      "safety": {
        "type": "object",
        "description": "Mint/freeze authority, LP and timelock state. Reports unknown as unknown, never as zero."
      },
      "symbol": {
        "type": "string"
      }
    }
  },
  inspect_token: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "activity": {
        "type": "object",
        "description": "transactions analysed and fee cost."
      },
      "groups": {
        "type": "object"
      },
      "holder_wealth": {
        "type": "object",
        "description": "top-50 SOL distribution; a median near zero is a launch distributed to nobody."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "top_holders": {
        "type": "array",
        "description": "rank, wallet, supply_pct, is_whale, is_notable."
      },
      "tracked_traders": {
        "type": "object",
        "description": "Activity from traders we follow by name."
      },
      "trading_patterns": {
        "type": "object",
        "description": "scalp score and wash-trading share."
      },
      "wallet_classes": {
        "type": "object",
        "description": "snipers, insiders, fresh_wallets, early_buyers."
      }
    }
  },
  token_report: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "depth": {
        "type": "string",
        "description": "Which tiers are included.",
        "enum": [
          "core",
          "full"
        ]
      },
      "identity": {
        "type": "object",
        "description": "The full body of the endpoint it names, exactly as that endpoint returns it."
      },
      "inspect": {
        "type": "object",
        "description": "The full body of the endpoint it names, exactly as that endpoint returns it."
      },
      "mint": {
        "type": "string",
        "description": "The token this describes."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "screen": {
        "type": "object",
        "description": "The full body of the endpoint it names, exactly as that endpoint returns it."
      }
    }
  },
  token_identity: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "creator": {
        "type": "object",
        "description": "address, allocation_pct, has_sold."
      },
      "identity": {
        "type": "object",
        "description": "holders_checked, holders_with_history (a COUNT), coverage_pct, prior_appearances,..."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "sibling_outcomes": {
        "type": "object",
        "description": "known vs rugged among the siblings."
      },
      "sibling_tokens": {
        "type": "array",
        "description": "Earlier tokens these wallets ran: mint, seen_at, shared_wallets, rugged."
      },
      "upside": {
        "type": "object",
        "description": "Measured 2x/5x rate for tokens whose holders carried this much winning history, against..."
      }
    }
  },
  find_tokens: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "count": {
        "type": "integer"
      },
      "filters": {
        "type": "object",
        "description": "The filters actually applied, echoed back — a caller should not have to guess whether a..."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "tokens": {
        "type": "array"
      }
    }
  },
  check_wallet: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "history": {
        "type": "object",
        "description": "Appearances, roles it recurs in, and its realised record across the index."
      },
      "known": {
        "type": "boolean",
        "description": "False when we have never seen this wallet in an indexed token. Never billed."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "trading": {
        "type": "object"
      },
      "wallet": {
        "type": "string",
        "description": "Solana wallet address (base58)."
      }
    }
  },
  can_i_exit: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "checked_at_sol_usd": {
        "type": "number",
        "description": "SOL price used to size the ladder, so a dollar rung can be reproduced later."
      },
      "exit": {
        "type": "object",
        "description": "verdict (clear/elevated/thin/trapped/blocked), action, worst_retained_pct, and a ladder of..."
      },
      "method": {
        "type": "string",
        "description": "How the answer was obtained, and what it cannot see. Quotes only — nothing is signed."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      }
    }
  },
  token_changes: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "changes": {
        "type": "object",
        "description": "Movement against the baseline: who left, who grew, and the supply behind it."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "ready": {
        "type": "boolean",
        "description": "False when we hold no holder baseline for this token; nothing is charged in that case."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      }
    }
  },
  token_price_path: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "coverage_note": {
        "type": "string",
        "description": "Where our feed starts, so the path is not mistaken for the token's whole life."
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "path": {
        "type": "object",
        "description": "analysed_at, first/last tick, tick count, market cap at analysis / latest / peak / trough,..."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      }
    }
  },
  find_serial_insiders: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "count": {
        "type": "integer"
      },
      "filters": {
        "type": "object"
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "wallets": {
        "type": "array",
        "description": "wallet, insider_in, also_held, early_investor_in, avg_supply_pct, realized_sol,..."
      }
    }
  },
  compare_tokens: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "compared": {
        "type": "array"
      },
      "count": {
        "type": "integer"
      },
      "in_all": {
        "type": "integer"
      },
      "not_covered": {
        "type": "array",
        "description": "mints we do not hold; the rest is still answered, as coverage 'partial'."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "shared": {
        "type": "array",
        "description": "wallet, in_tokens, mints, roles (holder / insider / early / sniper)."
      }
    }
  },
  test_hypothesis: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "cohort": {
        "type": "object",
        "description": "n, rug_pct, base_rate_pct, rug_lift_vs_base, median_peak_gain_pct, p75/p90_peak_gain_pct,..."
      },
      "disclaimer": {
        "type": "string",
        "description": "Measured history, not a forecast, and not adjusted for slippage or fees."
      },
      "filters": {
        "type": "object",
        "description": "The filters applied, echoed back."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "window_days": {
        "type": "integer"
      }
    }
  },
  get_scorecard: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "bands": {
        "type": "array"
      },
      "base_rate_pct": {
        "type": "number"
      },
      "calibrated_at": {
        "type": "string"
      },
      "says": {
        "type": "string"
      },
      "window_days": {
        "type": "number"
      }
    }
  },
  get_sample: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "identity": {
        "type": "object"
      },
      "inspect": {
        "type": "object"
      },
      "mint": {
        "type": "string"
      },
      "next": {
        "type": "array"
      },
      "not_shown": {
        "type": "object"
      },
      "says": {
        "type": "string"
      },
      "screen": {
        "type": "object"
      }
    }
  },
  token_graph: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "edges": {
        "type": "array",
        "description": "wallet_a/wallet_b ties with strength and confidence."
      },
      "edges_total": {
        "type": "integer",
        "description": "True edge count; compare against the returned array to detect truncation."
      },
      "members": {
        "type": "array",
        "description": "Which wallet sits in which cluster, and its role."
      },
      "members_total": {
        "type": "integer"
      },
      "mint": {
        "type": "string",
        "description": "Solana token mint address (base58)."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "wash_wallets": {
        "type": "array"
      }
    }
  },
  token_wallets: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "early_investors": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "early_total": {
        "type": "integer"
      },
      "fresh_total": {
        "type": "integer"
      },
      "fresh_wallets": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "insiders": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "insiders_total": {
        "type": "integer"
      },
      "kols": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "kols_total": {
        "type": "integer"
      },
      "mint": {
        "type": "string"
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "scalpers": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "snipers": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      },
      "snipers_total": {
        "type": "integer"
      },
      "wash_total": {
        "type": "integer"
      },
      "wash_wallets": {
        "type": "array",
        "description": "Addresses with funding source, cluster membership and flags. Capped at 100; the matching..."
      }
    }
  },
  token_web: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "common_wallets": {
        "type": "array",
        "description": "The shared wallets themselves, with which launches each ties."
      },
      "mint": {
        "type": "string"
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "tokens": {
        "type": "array",
        "description": "Launches sharing wallets with this one: mint, shared wallet count, outcome and the highest..."
      },
      "web_wallet_pool": {
        "type": "integer",
        "description": "Wallets considered when building the web."
      }
    }
  },
  wallet_network: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "direct": {
        "type": "array",
        "description": "Counterparts, each with the wallet, interaction count, shared tokens and transfer direction..."
      },
      "direct_total": {
        "type": "integer",
        "description": "Counterparts found, before the cap."
      },
      "edge_total": {
        "type": "integer",
        "description": "Edges behind both rings."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "second_hop": {
        "type": "array",
        "description": "A bounded second ring, reached through the direct counterparts."
      },
      "wallet": {
        "type": "string",
        "description": "The wallet asked about."
      }
    }
  },
  kol_leaderboard: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "count": {
        "type": "integer"
      },
      "filters": {
        "type": "object"
      },
      "kols": {
        "type": "array",
        "description": "wallet, name, handle, verified, followers, lifetime {trades, volume_sol, realized_sol,..."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      }
    }
  },
  kol_record: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "kol": {
        "type": "object",
        "description": "Identity and lifetime stats. Null when the address is not a tracked KOL; nothing is charged..."
      },
      "recent_trades": {
        "type": "array",
        "description": "Latest trades: side, sol, realized_sol, roi_pct, entry_mcap, timestamp."
      },
      "tokens": {
        "type": "array",
        "description": "Per-token rollup: mint, symbol, buys, sells, volume_sol, realized_sol, first and last trade..."
      }
    }
  },
  funder_networks: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "count": {
        "type": "integer"
      },
      "filters": {
        "type": "object"
      },
      "funders": {
        "type": "array",
        "description": "funder, funder_known (exchange name when we know the address, else null), wallets_funded,..."
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      }
    }
  },
  search_tokens: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "count": {
        "type": "integer"
      },
      "query": {
        "type": "object"
      },
      "says": {
        "type": "string",
        "description": "The finding in one plain sentence, safe to quote."
      },
      "tokens": {
        "type": "array",
        "description": "mint, symbol, name, analyzed_at, mcap_at_analysis, platform, holders, insiders, snipers,..."
      }
    }
  },
  search: {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "description": "Rows of {id, title, url}. id is the mint; pass it to fetch."
      },
      "count": {
        "type": "number"
      },
      "says": {
        "type": "string"
      },
      "_meta": {
        "type": "object",
        "description": "coverage, billing and price_usd for this call."
      }
    }
  },
  fetch: {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The mint this document is about."
      },
      "title": {
        "type": "string"
      },
      "url": {
        "type": "string",
        "description": "Public page for the token, or null if the id was not an address."
      },
      "text": {
        "type": "string",
        "description": "The full report as JSON text."
      },
      "metadata": {
        "type": "object"
      }
    }
  },
  get_coverage: {
    "type": "object",
    "properties": {
      "_meta": {
        "type": "object"
      },
      "history_from": {
        "type": "string"
      },
      "index": {
        "type": "object"
      },
      "not_covered": {
        "type": "object"
      },
      "platforms": {
        "type": "array"
      },
      "pricing": {
        "type": "object"
      },
      "start_here": {
        "type": "object"
      },
      "stats": {
        "type": "object"
      },
      "universe": {
        "type": "string"
      }
    }
  },
  get_balance: {
    "type": "object",
    "properties": {
      "key_prefix": {
        "type": "string"
      },
      "credit_balance": {
        "type": "number",
        "description": "Credits left. A new key starts at 0."
      },
      "free_remaining": {
        "type": "number"
      },
      "plan": {
        "type": "string"
      },
      "plan_credits_per_month": {
        "type": "number"
      },
      "plan_expires_at": {
        "type": "number"
      }
    }
  },
};
