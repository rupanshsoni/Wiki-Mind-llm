# WikiMind — Gap Analysis

Every row maps a required feature to which repository (if any) already implements it, what must change, and estimated effort.

**Effort key:** S = 1–3 days, M = 4–10 days, L = 11–25 days, XL = 25+ days

---

## Core Infrastructure

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Desktop app (Tauri v2) | ✅ Has it | ❌ | ❌ | Rename branding from "LLM Wiki" to "WikiMind" throughout Tauri config, Cargo.toml, package.json, dialog text, tray menu | S |
| Cross-platform packaging (.msi/.dmg/.deb/.AppImage) | ✅ Has it | ❌ | ❌ | Update bundle identifiers and icons. Verify builds still pass after rename. | S |
| React 19 + TypeScript frontend | ✅ Has it | ❌ | ❌ (Next.js, different stack) | Extend with new views (Maintenance dashboard). No migration needed. | — |
| Rust backend with Tauri commands | ✅ Has it | ❌ | ❌ | Add new command modules for maintenance, claims, contradictions. | — |
| Local HTTP API | ✅ Has it (`:19828`) | ❌ | ❌ (FastAPI, hosted) | Add claim/contradiction/maintenance endpoints to existing API server. | M |

---

## Knowledge Management

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Wiki page CRUD | ✅ Full CRUD via agent tools + editor | ✅ Via filesystem | ✅ Via VaultFS | Keep existing. Extend for claim/contradiction page types. | S |
| `concepts/` directory | ✅ Has it | ✅ `wiki/concepts/` | ✅ `wiki/concepts/` | Keep as-is. | — |
| `entities/` directory | ✅ Has it | ✅ `wiki/entities/` | ✅ `wiki/entities/` | Keep as-is. | — |
| `claims/` directory | ❌ **Not implemented** | ❌ | ❌ | **Build.** New page type with frontmatter schema, CRUD operations, claim extraction pipeline. | L |
| `contradictions/` directory | ❌ **Not implemented** | ❌ (mentions conflicts but no dedicated type) | ❌ | **Build.** New page type with judge votes, resolution status. | M |
| `sources/` (raw documents) | ✅ `raw/sources/` | ✅ `raw/` | ✅ Source upload | Keep as-is. | — |
| YAML frontmatter | ✅ Has it (title, description, date, tags) | ✅ Has it (rich per-type schemas) | ✅ Has it | Extend for claim-specific fields (confidence, source_count, freshness_state, etc.) | S |
| Wiki `index.md` | ✅ Has it | ✅ Has it | ✅ `overview.md` | Add claim statistics to index. | S |
| Wiki `log.md` | ✅ Has it | ✅ Has it (per-day split) | ✅ Has it | Add maintenance job entries to log format. | S |
| Knowledge graph | ✅ sigma.js + graphology + 4-signal model + Louvain | ❌ JSON Canvas only | ❌ | Extend with claim→concept edges and freshness-colored nodes. | M |

---

## Claim Decay System (All Net-New)

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Confidence score per claim | ❌ | ❌ | ❌ | **Build.** Frontmatter field + decay computation engine in Rust. | M |
| Decay formula (exponential with modifiers) | ❌ | ❌ | ❌ | **Build.** `decay.rs` module with tunable parameters. | M |
| Freshness state classification | ❌ | ❌ | ❌ | **Build.** fresh/aging/stale/decayed thresholds + UI indicators. | S |
| Source count tracking | ❌ | ❌ | ❌ | **Build.** Per-claim source provenance with verification timestamps. | S |
| Contradiction count tracking | ❌ | ❌ | ❌ | **Build.** Bidirectional link between claims and contradiction pages. | S |
| `last_verified` timestamp | ❌ | ⚠️ Recency markers exist but not formal timestamps | ❌ | **Build.** Automated timestamp update on re-verification. | S |
| Claim history array | ❌ | ⚠️ Bi-temporal `timeline:` pattern exists | ❌ | **Port + adapt.** Use obsidian-second-brain's bi-temporal pattern for claim history. | S |
| Domain volatility classification | ❌ | ❌ | ❌ | **Build.** Per-claim or per-tag volatility assignment. | S |

---

## Autonomous Maintenance Pipeline (All Net-New)

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Maintenance scheduler | ❌ | ⚠️ Pattern described but implemented via external cron | ❌ | **Build.** Tauri-native `tokio::time::interval` scheduler with cron expression parsing. | L |
| Stale claim detection | ❌ | ⚠️ Stale-claims agent in `/obsidian-health` | ❌ | **Build.** Batch decay scan across all claims, priority queue. | M |
| Re-research pipeline | ❌ | ⚠️ `/research-deep` exists but for manual use | ❌ | **Build.** Automated web search + source URL validation for stale claims. Reuse existing `web_search` tool. | M |
| Contradiction detection | ❌ | ⚠️ `/obsidian-reconcile` detects contradictions manually | ❌ | **Port + automate.** Adapt reconcile logic for autonomous operation. | M |
| Confidence update logic | ❌ | ❌ | ❌ | **Build.** Rules for corroboration (+) and contradiction (-) score adjustments. | S |
| Wiki page rewrite with history | ❌ | ⚠️ Sentinel markers `<!-- @generated -->` pattern | ❌ | **Build.** Git-style unified diff generation + `.wikimind/history/` storage. | M |
| Job logging | ❌ | ❌ | ❌ | **Build.** `maintenance/jobs.jsonl` append-only log. | S |
| Maintenance Tauri commands | ❌ | ❌ | ❌ | **Build.** New Tauri command module for scheduler control, job status, manual triggers. | M |

---

## Multi-Voter LLM-as-Judge Ensemble (All Net-New)

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Judge prompt template | ❌ | ❌ | ❌ | **Build.** Structured prompt for contradiction evaluation. | S |
| Multi-model judge invocation | ❌ | ❌ | ❌ | **Build.** Parallel LLM calls to 3 different providers. Reuse existing `AgentLlmProvider`. | M |
| Weighted majority voting | ❌ | ❌ | ❌ | **Build.** Vote aggregation with confidence weighting. | S |
| Escalation logic | ❌ | ❌ | ❌ | **Build.** Split decision → Review tab item with full judge reasoning. | S |
| Evaluation harness | ❌ | ❌ | ❌ | **Build.** Labeled test set, single-vs-ensemble comparison, FPR measurement. | L |
| Judge configuration UI | ❌ | ❌ | ❌ | **Build.** Settings panel for model selection, API keys per judge, budget cap. | M |

---

## 60+ Day Autonomous Run

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Scheduler persistence across app restarts | ❌ | ❌ | ❌ | **Build.** Schedule config in `.wikimind/schedule.json`, resume on app start. | M |
| Time-warp simulation mode | ❌ | ❌ | ❌ | **Build.** Configurable `time_warp_factor` for accelerated testing. | S |
| Maintenance dashboard UI | ❌ | ❌ | ❌ | **Build.** React views: health overview, decay curves, job history, contradictions, timeline. | L |
| Decay curve chart | ❌ | ❌ | ❌ | **Build.** Recharts line chart rendering claim confidence over time. | M |
| Job history view | ❌ | ❌ | ❌ | **Build.** Scrollable list from `jobs.jsonl` with expandable details. | S |
| Contradiction tracker UI | ❌ | ❌ | ❌ | **Build.** List of open contradictions with judge votes and action buttons. | M |
| Activity timeline | ❌ | ❌ | ❌ | **Build.** Unified event stream with filtering. | M |
| "Days running" counter | ❌ | ❌ | ❌ | **Build.** Derive from `jobs.jsonl` first/last entry timestamps. | S |

---

## MCP Surface

| Feature | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| Bundled MCP server | ✅ Node.js, 9 tools | ⚠️ Optional Python MCP | ✅ FastMCP Python | Keep existing Node.js server. Rename tools. | S |
| `guide` tool | ❌ | ❌ | ✅ Has it | **Port.** Adapt guide text for WikiMind. | S |
| `create` tool | ❌ (write via agent only) | ❌ | ✅ Has it | **Build.** MCP tool for creating pages with frontmatter validation. | S |
| `edit` tool | ❌ | ❌ | ✅ Has it | **Build.** MCP tool for editing pages with diff preservation. | S |
| `append` tool | ❌ | ❌ | ✅ Has it | **Build.** MCP tool for appending content. | S |
| `delete` tool | ❌ | ❌ | ✅ Has it | **Build.** MCP tool for deleting pages with logging. | S |
| `lint` tool | ❌ (lint is UI-only) | ❌ | ✅ Has it | **Build.** MCP tool for hygiene checks. | M |
| `claims` tool | ❌ | ❌ | ❌ | **Build.** List/filter claims by freshness. | S |
| `contradictions` tool | ❌ | ❌ | ❌ | **Build.** List open contradictions. | S |
| `decay_status` tool | ❌ | ❌ | ❌ | **Build.** Vault-wide decay statistics. | S |
| `maintenance_log` tool | ❌ | ❌ | ❌ | **Build.** Recent job history. | S |

---

## Ingestion Pipeline

| Source Type | `nashsu/llm_wiki` | `obsidian-second-brain` | `llmwiki` | What Needs to Change | Effort |
|---|---|---|---|---|---|
| PDF | ✅ pdfium + multimodal images | ❌ | ✅ (server-side) | Add post-ingest claim extraction step. | S |
| DOCX | ✅ docx-rs | ❌ | ❌ | Add post-ingest claim extraction step. | S |
| PPTX/XLSX | ✅ office_oxide/calamine | ❌ | ❌ | Add post-ingest claim extraction step. | S |
| Web articles | ✅ Chrome clipper + Readability.js | ❌ | ✅ (browser ext) | Add post-ingest claim extraction step. | S |
| YouTube/video transcripts | ❌ **Not implemented** | ✅ `youtube-transcript-api` | ❌ | **Port.** Wrap Python package, feed transcript to ingest pipeline. | M |
| GitHub repos | ❌ **Not implemented** | ❌ | ❌ | **Build.** Clone, read README + docs, extract claims about APIs/architecture. | M |
| Personal notes | ✅ Direct markdown editing | ✅ | ✅ | Add claim extraction on save/ingest. | S |
| Post-ingest claim extraction | ❌ **Not implemented** | ❌ | ❌ | **Build.** LLM pass to extract atomic claims from generated wiki pages. | L |

---

## Repository Cleanup

| Item | Status | Action | Effort |
|---|---|---|---|
| `tauri.conf.json` productName "LLM Wiki" | Exists | Rename to "WikiMind" | S |
| `Cargo.toml` package name "llm-wiki" | Exists | Rename to "wikimind" | S |
| `package.json` name "llm-wiki" | Exists | Rename to "wikimind" | S |
| `README.md` with nashsu credits/branding | Exists | Replace entirely | S |
| `logo.jpg` and old assets | Exists | Replace with WikiMind assets | S |
| `.llm-wiki/` project directory convention | In code | Rename to `.wikimind/` | M |
| Dialog text "LLM Wiki" in `lib.rs` | Exists | Rename | S |
| `llm-wiki.md` (Karpathy copy) | Exists | Move to `reference/` | S |
| `README_CN.md`, `README_JA.md`, `README_KO.md` | Exist | Remove (or regenerate for WikiMind) | S |
| MCP server "llm-wiki" references | In `mcp-server/src/` | Rename to "wikimind" | S |
| Extension manifest "LLM Wiki" references | In `extension/manifest.json` | Rename | S |
| `.github/` workflows referencing LLM Wiki | May exist | Update | S |

---

## Effort Summary

| Category | S | M | L | XL | Total Items |
|---|---|---|---|---|---|
| Core Infrastructure | 2 | 1 | 0 | 0 | 3 |
| Knowledge Management | 4 | 2 | 1 | 0 | 7 |
| Claim Decay System | 5 | 2 | 0 | 0 | 7 |
| Autonomous Maintenance | 3 | 5 | 1 | 0 | 9 |
| Judge Ensemble | 3 | 2 | 1 | 0 | 6 |
| 60-Day Run + Dashboard | 3 | 4 | 1 | 0 | 8 |
| MCP Surface | 7 | 1 | 0 | 0 | 8 |
| Ingestion Pipeline | 5 | 2 | 1 | 0 | 8 |
| Repository Cleanup | 10 | 1 | 0 | 0 | 11 |
| **Totals** | **42** | **20** | **5** | **0** | **67** |

**Rough total estimate:** ~42S (≈84 days) + 20M (≈140 days) + 5L (≈85 days) = ~309 person-days for a single developer. With parallelization and the fact that many S items are trivial renames: realistic calendar time is **8–12 weeks** for a focused effort.
