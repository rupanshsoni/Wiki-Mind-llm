# WikiMind — Architecture

---

## System Overview

WikiMind is a self-organizing knowledge agent that ingests documents, builds a structured wiki, and **continuously audits its own past**. Every claim carries a confidence score that decays without re-verification. Autonomous maintenance jobs detect stale claims, re-research them, reconcile contradictions through a multi-voter LLM-judge ensemble, and rewrite wiki pages while preserving full edit history.

```
┌────────────────────────────────────────────────────────────────────┐
│                        WikiMind Desktop App                        │
│                         (Tauri v2 + Rust)                          │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │   React 19   │  │  Rust Agent  │  │   Maintenance Scheduler  │ │
│  │   Frontend   │◄─┤   Runtime    │◄─┤   (Tokio intervals)      │ │
│  │              │  │              │  │                            │ │
│  │ • Editor     │  │ • LLM calls  │  │ • Decay scan (nightly)    │ │
│  │ • Graph      │  │ • Tool exec  │  │ • Re-verify (2x/week)    │ │
│  │ • Chat       │  │ • Streaming  │  │ • Ensemble (weekly)       │ │
│  │ • Review     │  │ • Sessions   │  │ • Health report (monthly) │ │
│  │ • Dashboard  │  │ • Cancel     │  │                            │ │
│  └──────────────┘  └──────┬───────┘  └────────────┬─────────────┘ │
│                           │                        │               │
│  ┌────────────────────────┴────────────────────────┴─────────────┐ │
│  │                    Local Filesystem Vault                      │ │
│  │  wiki/ (concepts, entities, claims, contradictions, log, idx) │ │
│  │  raw/sources/ (immutable ingested documents)                   │ │
│  │  .wikimind/ (project config, job logs, history diffs, eval)   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  LanceDB     │  │  HTTP API    │  │  MCP Server (Node.js)    │ │
│  │  Vector Store │  │  :19828      │  │  stdio transport         │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
         ▲                    ▲                     ▲
         │                    │                     │
    LLM APIs            Chrome Clipper       Downstream Agents
  (OpenAI, Anthropic,   (browser ext)      (ForgeLoop, SkillForge
   Google, local)                            via MCP tools)
```

---

## Module Map

### Kept As-Is from `nashsu/llm_wiki`

| Module | Path | Role |
|---|---|---|
| Tauri bootstrap | `src-tauri/src/lib.rs` | App lifecycle, plugin registration, managed state |
| API server | `src-tauri/src/api_server.rs` | HTTP API on `:19828` with rate limiting, CORS |
| Clip server | `src-tauri/src/clip_server.rs` | Chrome extension clip receiver |
| Agent runtime | `src-tauri/src/agent/runtime.rs` | LLM tool-use loop with structured output, streaming events |
| Agent tools | `src-tauri/src/agent/tools.rs` | wiki.read, wiki.write, web.search, graph.search, shell.exec, source.search |
| Agent sessions | `src-tauri/src/agent/session.rs` | Conversation persistence |
| Agent skills | `src-tauri/src/agent/skills.rs` | SKILL.md discovery and injection |
| Agent provider | `src-tauri/src/agent/provider.rs` | Multi-provider LLM client (OpenAI-compatible) |
| Vector store | `src-tauri/src/commands/vectorstore.rs` | LanceDB embedding storage and search |
| File operations | `src-tauri/src/commands/fs.rs` | Read/write/preprocess files, PDF/DOCX/PPTX/XLSX extraction |
| Image extraction | `src-tauri/src/commands/extract_images.rs` | Multimodal image extraction from PDFs/Office |
| Search | `src-tauri/src/commands/search.rs` | Keyword + vector hybrid search |
| File sync | `src-tauri/src/commands/file_sync.rs` | Source folder watch with change queue |
| React frontend | `src/` | Full editor, chat, graph, review, settings UI |
| Knowledge graph | `src/components/graph/` | sigma.js + graphology + Louvain community detection |
| MCP server | `mcp-server/` | Node.js MCP server with 9 tools |
| Chrome extension | `extension/` | Web clipper with Readability.js |

### Modified from `nashsu/llm_wiki`

| Module | Change | Rationale |
|---|---|---|
| `src-tauri/tauri.conf.json` | Rename `LLM Wiki` → `WikiMind`, update identifier | Branding |
| `src-tauri/Cargo.toml` | Rename package, add `cron` crate for schedule parsing | Scheduler needs cron expressions |
| `src-tauri/src/lib.rs` | Add `MaintenanceScheduler` managed state, register new commands | Scheduler integration |
| `src-tauri/src/api_server.rs` | Add `/api/v1/claims`, `/api/v1/contradictions`, `/api/v1/maintenance` endpoints | New API surface |
| `src-tauri/src/agent/tools.rs` | Add `claims.list`, `claims.create`, `contradictions.list`, `decay.status` tools | Agent needs claim awareness |
| `src-tauri/src/agent/runtime.rs` | Post-ingest hook for claim extraction | Automatic claim extraction |
| `mcp-server/src/index.ts` | Rename all tools `llm_wiki_*` → `wikimind_*`, add 10 new tools | MCP surface extension |
| `src/App.tsx` | Add "Maintenance" sidebar tab routing | Dashboard navigation |
| `src/stores/wiki-store.ts` | Add claim/contradiction state management | Frontend data layer |
| `package.json` | Rename, add `recharts` for dashboard charts | Dashboard charting |


### Net-New Modules

| Module | Path | Description |
|---|---|---|
| Claim manager | `src-tauri/src/maintenance/claims.rs` | CRUD for claims, decay computation, freshness classification |
| Contradiction manager | `src-tauri/src/maintenance/contradictions.rs` | CRUD for contradictions, judge vote storage |
| Decay engine | `src-tauri/src/maintenance/decay.rs` | The decay formula implementation with tunable parameters |
| Judge ensemble | `src-tauri/src/maintenance/ensemble.rs` | Multi-voter LLM judge: prompt construction, vote aggregation, escalation |
| Maintenance scheduler | `src-tauri/src/maintenance/scheduler.rs` | Tokio interval-based job scheduler with cron expression parsing |
| Maintenance pipeline | `src-tauri/src/maintenance/pipeline.rs` | Orchestrates: detect stale → re-research → reconcile → update → rewrite → log |
| History tracker | `src-tauri/src/maintenance/history.rs` | Git-style unified diff generation and storage |
| Evaluation harness | `src-tauri/src/maintenance/eval.rs` | Single-judge vs. ensemble comparison, FPR measurement |
| Claim extraction | `src-tauri/src/maintenance/extract.rs` | Post-ingest LLM pass to extract atomic claims from wiki pages |
| YouTube command | `src-tauri/src/commands/youtube.rs` | YouTube transcript fetch and ingest |
| GitHub command | `src-tauri/src/commands/github.rs` | GitHub repo clone, README/doc reading, claim extraction |
| Maintenance dashboard | `src/components/maintenance/` | React views: health overview, decay curves, job history, contradictions, timeline |
| Claim editor | `src/components/editor/claim-editor.tsx` | Claim-specific editor with confidence display and history |
| Decay chart | `src/components/maintenance/decay-chart.tsx` | Recharts line chart for confidence over time |

---

## Data Flow

### Ingestion Flow (existing + new claim extraction)

```
Source document (PDF/web/DOCX/video/GitHub)
    │
    ▼
Preprocessor (existing: pdfium, docx-rs, calamine, Readability.js)
    │
    ▼
Two-step chain-of-thought ingest (existing agent runtime)
    │
    ├──→ Wiki pages created/updated (concepts/, entities/)
    │         │
    │         ▼
    │    Claim Extraction Pass (NEW)
    │         │
    │         ├──→ Dedup check (vector search against existing claims)
    │         ├──→ Create claims/*.md with initial confidence
    │         └──→ Update parent concept/entity pages (claim_count, avg_confidence)
    │
    ├──→ Source indexed in LanceDB (existing)
    ├──→ Knowledge graph updated (existing)
    ├──→ Review items generated (existing)
    └──→ log.md appended (existing)
```

### Maintenance Flow (entirely new)

```
Scheduler tick (configurable cron)
    │
    ▼
Decay scan: compute C(t) for all claims
    │
    ├──→ Fresh claims: no action
    ├──→ Aging claims: log warning, update freshness_state
    └──→ Stale/Decayed claims: queue for re-verification
              │
              ▼
         Re-research (web search + source URL checks)
              │
              ├──→ Evidence corroborates: bump source_count, refresh confidence
              ├──→ Evidence contradicts: create contradictions/*.md
              │         │
              │         ▼
              │    Judge Ensemble (3 LLMs, weighted majority)
              │         │
              │         ├──→ Clear verdict: resolve contradiction, update claim
              │         ├──→ Split: escalate to Review tab
              │         └──→ Needs evidence: schedule deeper research
              │
              └──→ No new evidence found: decay continues, flag for human review
                        │
                        ▼
                   Rewrite pages + store diffs + update log + emit UI events
```

### Query Flow (existing + claim awareness)

```
User query (chat or MCP)
    │
    ▼
Agent runtime (existing: route, retrieve, synthesize)
    │
    ├──→ Wiki search (existing)
    ├──→ Claim confidence check (NEW: flag stale claims in response)
    ├──→ Contradiction awareness (NEW: note unresolved disputes)
    └──→ Response with confidence annotations
```

---

## Vault Schema

### Directory Layout

```
project/
├── wiki/
│   ├── overview.md              # Hub page with vault statistics
│   ├── index.md                 # Content catalog
│   ├── log.md                   # Append-only operation log
│   ├── concepts/                # Abstract ideas, methodologies
│   ├── entities/                # Concrete things: people, orgs, tools
│   ├── claims/                  # NEW: Atomic verifiable assertions
│   ├── contradictions/          # NEW: Documented disagreements
│   └── comparisons/             # X-vs-Y analysis pages
├── raw/
│   └── sources/                 # Immutable ingested documents
└── .wikimind/
    ├── project.json             # Project UUID and metadata
    ├── maintenance/
    │   ├── jobs.jsonl           # NEW: Maintenance job log
    │   ├── schedule.json        # NEW: Scheduler configuration
    │   └── eval/                # NEW: Judge evaluation data
    │       ├── cases.jsonl
    │       └── results.jsonl
    └── history/
        └── *.diff              # NEW: Page rewrite diffs
```

### Reconciliation of Existing vs. Required Structure

The base repo uses: `entities/`, `concepts/`, `sources/`, `queries/`, `synthesis/`, `comparisons/`. The required schema is: `concepts/`, `claims/`, `contradictions/`, `sources/`.

| Existing | Decision |
|---|---|
| `concepts/` | **Keep.** Maps directly. |
| `entities/` | **Keep.** The requirement lists `concepts/` and `claims/` but entities are a distinct valuable category (people, orgs, tools). |
| `claims/` | **Add.** Does not exist. This is the core WikiMind addition. |
| `contradictions/` | **Add.** Does not exist. |
| `sources/` → `raw/sources/` | **Keep.** Already exists as the immutable source layer. |
| `queries/` | **Remove from default schema.** Query results should be filed as concepts or claims. Existing query pages migrate to concepts/. |
| `synthesis/` | **Remove from default schema.** Synthesis is what concepts/ is for. Existing synthesis pages migrate to concepts/. |
| `comparisons/` | **Keep.** Useful for explicit X-vs-Y analysis. |

---

## Decay Formula

### Definition

```
C(t) = C_base × exp(-λ_eff × Δt)

λ_eff = λ₀ × V × (1 / (1 + α × S)) × (1 + β × K)
```

| Parameter | Default | Meaning |
|---|---|---|
| `λ₀` | 0.01 | Base decay constant. Half-life ≈ 69 days with no modifiers. |
| `V` | `{low: 0.5, medium: 1.0, high: 2.0}` | Domain volatility multiplier. AI/crypto = high, mathematics = low. |
| `α` | 0.3 | Source-damping factor. More independent sources → slower decay. |
| `S` | `source_count` | Number of independent sources corroborating the claim. |
| `β` | 0.5 | Contradiction-acceleration factor. Active contradictions → faster decay. |
| `K` | `contradiction_count` | Number of unresolved contradictions. |

### Freshness Thresholds

| State | Condition | UI Color |
|---|---|---|
| `fresh` | `C(t) ≥ 0.7 × C_base` | Green |
| `aging` | `0.4 × C_base ≤ C(t) < 0.7 × C_base` | Yellow |
| `stale` | `0.2 × C_base ≤ C(t) < 0.4 × C_base` | Orange |
| `decayed` | `C(t) < 0.2 × C_base` | Red |

Decay is computed lazily on read. The scheduler queries claims to build its work queue by computing freshness in a batch scan.

---

## Reconciliation Ensemble

Three LLM judges from different model families evaluate each contradiction. Weighted majority voting with escalation for split decisions. See `DATA_MODELS.md` for the full judge prompt template and vote schema. See `RISKS.md` for cost and latency analysis.

---

## Scheduler

Tauri-managed state using `tokio::time::interval`. Jobs defined by cron expressions in `.wikimind/schedule.json`. Each job type (decay_scan, re_verification, contradiction_resolution, health_report) runs independently. Jobs log to `maintenance/jobs.jsonl` and emit Tauri events for the dashboard UI.

The scheduler supports a `time_warp_factor` for development/testing (accelerated simulation). Production runs use `time_warp_factor: 1`. The factor is displayed in the UI and logged with every job.
