# WikiMind — Phased Task Backlog

**Model assignment hints:** `agent` = LLM-assisted coding agent, `human` = requires human judgment/testing, `either` = straightforward enough for either.

---
## Update the status of each task as done in this file after they are completed.

## Phase 0: Repository Cleanup & Branding (Days 1–3)

> **Goal:** Remove all traces of LLM Wiki. The project compiles and runs as "WikiMind" with no external branding.

### [DONE] P0-01: Rename Tauri configuration
- **Description:** Update `productName`, `identifier`, window title, and dialog text in `tauri.conf.json`, platform-specific configs, and `lib.rs`.
- **Acceptance criteria:** App window title says "WikiMind". Tray menu says "WikiMind". Quit dialog says "WikiMind". `com.wikimind.app` is the identifier.
- **Model assignment:** agent

### [DONE] P0-02: Rename Rust package
- **Description:** Update `Cargo.toml` package name from `llm-wiki` to `wikimind`, library name from `llm_wiki_lib` to `wikimind_lib`, binary name from `llm-wiki` to `wikimind`. Update all internal references.
- **Acceptance criteria:** `cargo build` succeeds with new package name. No references to `llm-wiki` or `llm_wiki` remain in Rust code.
- **Model assignment:** agent

### [DONE] P0-03: Rename frontend package
- **Description:** Update `package.json` name from `llm-wiki` to `wikimind`. Update any import paths that reference the old name.
- **Acceptance criteria:** `npm run build` succeeds. `npm run test:mocks` passes.
- **Model assignment:** agent

### [DONE] P0-04: Rename MCP server
- **Description:** Rename all MCP tool names from `llm_wiki_*` to `wikimind_*` in `mcp-server/src/index.ts`. Update server name, console log messages, error messages.
- **Acceptance criteria:** `npm run mcp:build` succeeds. `npm run mcp:test` passes. All tool names start with `wikimind_`.
- **Model assignment:** agent

### [DONE] P0-05: Rename project directory convention
- **Description:** Change `.llm-wiki/` to `.wikimind/` in all Rust code that reads/writes `project.json`, including `read_project_id()` in `lib.rs`, and anywhere in the frontend/stores.
- **Acceptance criteria:** New projects create `.wikimind/project.json`. Existing `.llm-wiki/` directories are auto-migrated (read from either, write to new).
- **Model assignment:** agent

### [DONE] P0-06: Replace README and assets
- **Description:** Write new `README.md` for WikiMind. Remove `README_CN.md`, `README_JA.md`, `README_KO.md`. Remove or replace `logo.jpg`. Remove `llm-wiki.md` (move to `reference/`). Update `assets/` screenshots when new UI is ready (placeholder for now).
- **Acceptance criteria:** No references to "LLM Wiki", "nash_su", or old repo names in any user-facing file. `README.md` accurately describes WikiMind.
- **Model assignment:** either

### [DONE] P0-07: Update Chrome extension
- **Description:** Rename "LLM Wiki" references in `extension/manifest.json` and `extension/popup.html`.
- **Acceptance criteria:** Extension popup says "WikiMind". No "LLM Wiki" text visible.
- **Model assignment:** agent

### [DONE] P0-08: Verify clean build
- **Description:** Run full build pipeline: `cargo build`, `npm run build`, `npm run tauri build` (or `dev`). Fix any breakage from renames.
- **Acceptance criteria:** Desktop app launches successfully with all renames applied. All existing tests pass.
- **Model assignment:** human

---

## Phase 1: Claim Infrastructure (Days 4–14)

> **Goal:** Claims exist as a first-class page type. Users can create, view, and search claims. The decay formula computes freshness.

### [DONE] P1-01: Claim frontmatter schema
- **Description:** Define and document the claim frontmatter YAML schema (confidence, source_count, last_verified, contradiction_count, freshness_state, domain_volatility, sources array, parent_concepts, contradictions, history array). Add YAML parsing support in `commands/fs.rs` for claim-specific fields.
- **Acceptance criteria:** A claim page with full frontmatter can be created, read, and parsed. All fields are accessible programmatically.
- **Model assignment:** agent

### [DONE] P1-02: Decay engine (Rust module)
- **Description:** Create `src-tauri/src/maintenance/decay.rs` implementing `C(t) = C_base × exp(-λ_eff × Δt)` with configurable parameters. Include unit tests with known inputs and expected outputs.
- **Acceptance criteria:** `decay::compute_confidence(claim_metadata, now)` returns correct values. `decay::classify_freshness(confidence, base)` returns correct state. All unit tests pass.
- **Model assignment:** agent

### [DONE] P1-03: Claim manager (Rust module)
- **Description:** Create `src-tauri/src/maintenance/claims.rs` with CRUD operations: list claims (with freshness filter/sort), read claim with computed decay, create claim, update claim. Operates on `wiki/claims/*.md` files.
- **Acceptance criteria:** `claims::list(project_path, filter)` returns claims sorted by freshness. `claims::create(project_path, claim_data)` writes valid frontmatter. `claims::update(...)` preserves history array.
- **Model assignment:** agent

### [DONE] P1-04: Contradiction manager (Rust module)
- **Description:** Create `src-tauri/src/maintenance/contradictions.rs` with CRUD: list contradictions (by status), create contradiction linking two claims, update with judge votes, resolve.
- **Acceptance criteria:** Contradictions link to claims bidirectionally. Status transitions (open → under_review → resolved/escalated) are enforced.
- **Model assignment:** agent

### [DONE] P1-05: Maintenance module scaffolding
- **Description:** Create `src-tauri/src/maintenance/mod.rs` aggregating claims, contradictions, decay, and the modules built in later phases. Register the maintenance module in `lib.rs`.
- **Acceptance criteria:** Module compiles. Tauri commands for claim listing and decay status are registered and callable from frontend.
- **Model assignment:** agent

### [DONE] P1-06: Tauri commands for claims
- **Description:** Add Tauri commands: `maintenance_list_claims`, `maintenance_get_claim`, `maintenance_create_claim`, `maintenance_decay_status` (vault-wide statistics: total claims, freshness distribution).
- **Acceptance criteria:** Frontend can invoke these commands and receive typed responses.
- **Model assignment:** agent

### [DONE] P1-07: Claims UI — list view
- **Description:** Create `src/components/maintenance/claims-list.tsx`. Display claims in a table with columns: title, confidence (with color-coded freshness badge), source count, last verified, contradiction count. Sortable and filterable by freshness state.
- **Acceptance criteria:** Claims list renders from real data. Freshness badges show correct colors. Sorting works.
- **Model assignment:** agent

### [DONE] P1-08: Claims UI — detail view
- **Description:** Create `src/components/maintenance/claim-detail.tsx`. Show full claim frontmatter, confidence decay visualization (simple bar or gauge), source list, linked concepts, history timeline.
- **Acceptance criteria:** Clicking a claim in the list opens the detail view. All frontmatter fields display correctly.
- **Model assignment:** agent

### [DONE] P1-09: Extend concept/entity frontmatter
- **Description:** Add `claim_count`, `stale_claim_count`, `avg_confidence`, `last_audited` fields to concept and entity page frontmatter. Update the editor to display these when present.
- **Acceptance criteria:** When a concept page has linked claims, the aggregate statistics show in the editor sidebar.
- **Model assignment:** agent

---

## Phase 2: Claim Extraction Pipeline (Days 15–24)

> **Goal:** Ingesting a source automatically extracts atomic claims. Claims are deduplicated against existing claims via vector search.

### [DONE] P2-01: Claim extraction prompt
- **Description:** Design and test the LLM prompt that extracts atomic, verifiable claims from a wiki page. The prompt must produce structured JSON output with claim text, confidence estimate, domain volatility hint, and source reference.
- **Acceptance criteria:** Given a wiki page about "Transformer Architecture", the prompt extracts 5-15 distinct claims with valid JSON output. Manual review confirms claims are atomic and verifiable.
- **Model assignment:** human (prompt engineering)

### [DONE] P2-02: Claim extraction module
- **Description:** Create `src-tauri/src/maintenance/extract.rs`. Given a wiki page path, calls the LLM with the extraction prompt, parses the JSON response, and returns a list of candidate claims.
- **Acceptance criteria:** `extract::extract_claims(page_path, runtime)` returns a Vec of claim candidates with all required fields.
- **Model assignment:** agent

### [DONE] P2-03: Claim deduplication
- **Description:** Before creating a new claim, vector-search existing claims for semantic similarity. If similarity > threshold (0.85), update the existing claim (bump source_count, add source reference) instead of creating a duplicate.
- **Acceptance criteria:** Ingesting two PDFs about the same topic does not create duplicate claims. Existing claims gain additional sources.
- **Model assignment:** agent

### [DONE] P2-04: Post-ingest hook
- **Description:** Modify the agent runtime's wiki write tool to trigger claim extraction after any page in `concepts/` or `entities/` is created or substantially updated. Queue extraction as an async task.
- **Acceptance criteria:** After ingesting a PDF and generating wiki pages, claims appear in `claims/` within 30 seconds. No claims are created for trivial edits.
- **Model assignment:** agent

### [DONE] P2-05: Extend knowledge graph with claims
- **Description:** Add claim nodes to the sigma.js graph. Claims connect to their parent concepts/entities. Node color reflects freshness state. Contradictions are shown as red edges between claim nodes.
- **Acceptance criteria:** The graph view shows claim nodes. Hovering a claim shows its confidence. Contradiction edges are visually distinct.
- **Model assignment:** agent

---

## Phase 3: Autonomous Maintenance Scheduler (Days 25–38)

> **Goal:** The system runs maintenance jobs on a schedule. Stale claims are detected and queued for re-verification.

### [DONE] P3-01: Scheduler engine
- **Description:** Create `src-tauri/src/maintenance/scheduler.rs`. Implements a `MaintenanceScheduler` struct managed by Tauri. Parses cron expressions from `.wikimind/schedule.json`. Spawns Tokio tasks on schedule. Supports `time_warp_factor` for accelerated testing.
- **Acceptance criteria:** Scheduler starts on app launch. Jobs fire at configured times. `time_warp_factor=24` causes a daily job to fire every hour. Jobs can be paused/resumed from the UI.
- **Model assignment:** agent

### [DONE] P3-02: Schedule configuration
- **Description:** Create default `.wikimind/schedule.json` with four job types (decay_scan, re_verification, contradiction_resolution, health_report). Add a Settings panel for editing schedule parameters and decay formula constants.
- **Acceptance criteria:** Users can modify cron expressions and decay parameters from Settings. Changes take effect without app restart.
- **Model assignment:** agent

### [DONE] P3-03: Decay scan job
- **Description:** Implement the `decay_scan` job type: iterate all `claims/*.md`, compute `C(now)` for each, update `freshness_state` frontmatter, build a priority queue of stale claims.
- **Acceptance criteria:** After a decay scan, all claim pages have up-to-date `freshness_state`. The job log records the number of claims in each freshness category.
- **Model assignment:** agent

### [DONE] P3-04: Job logging
- **Description:** Create `src-tauri/src/maintenance/jobs.rs`. Append structured JSON to `.wikimind/maintenance/jobs.jsonl` after each job completes. Include: job_id, type, start/end time, claims scanned, actions taken, errors.
- **Acceptance criteria:** After running any maintenance job, a new line appears in `jobs.jsonl` with correct data. The file is valid JSONL.
- **Model assignment:** agent

### [DONE] P3-05: Re-research pipeline
- **Description:** Create `src-tauri/src/maintenance/pipeline.rs`. For each stale claim: generate search queries from claim text, execute web search via existing `web_search` tool, check source URLs with HTTP HEAD, collect new evidence.
- **Acceptance criteria:** Given a stale claim about a product's pricing, the pipeline finds current pricing information via web search. New evidence is structured as potential sources.
- **Model assignment:** agent

### [DONE] P3-06: Confidence update logic
- **Description:** Implement rules in `pipeline.rs`: corroboration bumps `C_base` by `+0.05 × new_sources`, contradiction drops `C_base` by `-0.15`, neutral re-verification resets `last_verified` without changing `C_base`.
- **Acceptance criteria:** Unit tests verify all three update paths. History array is appended correctly.
- **Model assignment:** agent

### [DONE] P3-07: History tracker
- **Description:** Create `src-tauri/src/maintenance/history.rs`. Generate unified diffs between old and new page content. Store as `.wikimind/history/{slug}_{timestamp}.diff`. Read diffs for the history view.
- **Acceptance criteria:** After a claim page is rewritten, a valid unified diff exists in the history directory. The diff can be applied to reconstruct the old version.
- **Model assignment:** agent

### [DONE] P3-08: Maintenance Tauri commands
- **Description:** Add commands: `maintenance_scheduler_status`, `maintenance_run_job` (manual trigger), `maintenance_pause_scheduler`, `maintenance_resume_scheduler`, `maintenance_job_history`.
- **Acceptance criteria:** Frontend can check scheduler status, manually trigger a decay scan, and view job history.
- **Model assignment:** agent

---

## Phase 4: Multi-Voter Judge Ensemble (Days 39–52)

> **Goal:** Contradictions are resolved by a 3-judge ensemble. The evaluation harness measures false-positive reduction.

### [DONE] P4-01: Judge prompt template
- **Description:** Design the judge prompt template as documented in `DATA_MODELS.md`. The prompt presents both claims, their sources, and any new evidence, and asks for a structured JSON verdict.
- **Acceptance criteria:** The prompt produces valid JSON responses from GPT-4o, Claude Sonnet, and Gemini Pro. Verdicts are one of: accept_a, accept_b, merge, needs_evidence, escalate.
- **Model assignment:** human (prompt engineering)

### [DONE] P4-02: Judge ensemble module
- **Description:** Create `src-tauri/src/maintenance/ensemble.rs`. Sends the judge prompt to 3 configured LLM providers in parallel. Collects responses. Implements weighted majority aggregation.
- **Acceptance criteria:** Given a contradiction and 3 mock judge responses, aggregation produces the correct outcome. All voting rules (unanimous, supermajority, split) are tested.
- **Model assignment:** agent

### [DONE] P4-03: Multi-provider LLM configuration
- **Description:** Extend the existing Settings UI and `AgentRuntimeConfig` to support 3 separate LLM provider configurations (one per judge). Each judge can use a different API endpoint, model, and key.
- **Acceptance criteria:** Users can configure 3 different models for the judge ensemble. Configuration persists in app-state.json.
- **Model assignment:** agent

### [DONE] P4-04: Ensemble integration with pipeline
- **Description:** Wire the ensemble into `pipeline.rs`: when the re-research step detects a contradiction, create the contradiction page and invoke the ensemble. Apply the verdict (resolve, escalate, or schedule deeper research).
- **Acceptance criteria:** End-to-end: a stale claim with contradicting new evidence → contradiction page created → ensemble runs → verdict applied → claim updated.
- **Model assignment:** agent

### [DONE] P4-05: Escalation to Review tab
- **Description:** When the ensemble produces an `escalate` verdict, create a Review item (using the existing review system) with: contradiction summary, all three judge reasonings, and action buttons (Accept A, Accept B, Merge, Dismiss).
- **Acceptance criteria:** Escalated contradictions appear in the Review tab. Human resolution updates the contradiction page and linked claims.
- **Model assignment:** agent

### [DONE] P4-06: Evaluation harness
- **Description:** Create `src-tauri/src/maintenance/eval.rs`. Build and maintain a labeled evaluation set in `.wikimind/maintenance/eval/`. For each labeled case, compare single-judge (judge 1 only) vs. ensemble outcome against ground truth. Report false-positive rates for both.
- **Acceptance criteria:** Given ≥20 labeled cases, the harness computes FPR for single-judge and ensemble modes and reports the reduction percentage. Results are stored in `eval/results.jsonl`.
- **Model assignment:** agent

### [DONE] P4-07: API budget tracking
- **Description:** Track API spending for automated maintenance calls. Display current month's spending vs. cap in Settings. Pause automated jobs if cap is reached.
- **Acceptance criteria:** Each LLM call in the maintenance pipeline increments the spending counter. Jobs pause when budget is exhausted. Users are notified.
- **Model assignment:** agent

---

## Phase 5: Maintenance Dashboard UI (Days 53–65)

> **Goal:** A rich monitoring view showing decay curves, job history, contradictions, and system health.

### [DONE] P5-01: Maintenance sidebar tab
- **Description:** Add a "Maintenance" tab to the app sidebar (alongside Editor, Graph, Chat, Review). Route to the maintenance dashboard component.
- **Acceptance criteria:** Clicking the Maintenance tab shows the dashboard. Tab icon is appropriate (e.g., shield or heartbeat).
- **Model assignment:** agent

### [DONE] P5-02: Health overview panel
- **Description:** Create `src/components/maintenance/health-overview.tsx`. Display: total claims, breakdown by freshness state (donut chart), days running, total jobs completed, next scheduled job.
- **Acceptance criteria:** Panel renders with real data from `maintenance_decay_status` command. Donut chart shows correct proportions with freshness colors.
- **Model assignment:** agent

### [DONE] P5-03: Decay curves panel
- **Description:** Create `src/components/maintenance/decay-chart.tsx`. Recharts line chart showing selected claim's confidence over time (from history array). Support overlaying multiple claims. Show re-verification events as markers.
- **Acceptance criteria:** Selecting a claim renders its confidence trajectory. Multiple claims can be compared on the same chart.
- **Model assignment:** agent

### [DONE] P5-04: Job history panel
- **Description:** Create `src/components/maintenance/job-history.tsx`. Scrollable list from `jobs.jsonl`. Each row: timestamp, job type, claims processed, contradictions found/resolved, errors. Expandable for full details.
- **Acceptance criteria:** Job history loads from file. Most recent jobs appear first. Expanding a row shows the full JSON.
- **Model assignment:** agent

### [DONE] P5-05: Contradictions panel
- **Description:** Create `src/components/maintenance/contradictions-panel.tsx`. List open contradictions with: the two claims, judge votes (if run), resolution status. Action buttons: "Run Ensemble", "Escalate", "Resolve Manually".
- **Acceptance criteria:** Open contradictions are listed. Clicking "Run Ensemble" triggers the judge ensemble and updates the display. Resolved contradictions are hidden by default.
- **Model assignment:** agent

### [DONE] P5-06: Activity timeline
- **Description:** Create `src/components/maintenance/activity-timeline.tsx`. Unified timeline of: ingests, claim extractions, re-verifications, contradiction resolutions, rewrites. Filterable by event type. Sources from both `log.md` and `jobs.jsonl`.
- **Acceptance criteria:** Timeline displays events chronologically. Filters work. Clicking an event navigates to the relevant page.
- **Model assignment:** agent

### [DONE] P5-07: Ensemble evaluation display
- **Description:** Add a section to the Settings or Maintenance dashboard showing: evaluation set size, FPR for single-judge vs. ensemble, reduction percentage. Update automatically when new results are logged.
- **Acceptance criteria:** If ≥20 labeled cases exist, the display shows "Ensemble FPR: X% vs Single-Judge FPR: Y% → Z% reduction".
- **Model assignment:** agent

---

## Phase 6: MCP Extension & Ingestion (Days 66–78)

> **Goal:** Full MCP tool surface. YouTube and GitHub ingestion. WikiMind serves as the knowledge layer for downstream agents.

### [DONE] P6-01: New MCP tools — CRUD
- **Description:** Add `wikimind_guide`, `wikimind_create`, `wikimind_edit`, `wikimind_append`, `wikimind_delete`, `wikimind_lint` to the MCP server. Wire through the HTTP API.
- **Acceptance criteria:** Each tool can be invoked via MCP and produces correct results. `wikimind_guide` returns WikiMind-specific documentation.
- **Model assignment:** agent

### [DONE] P6-02: New MCP tools — WikiMind-specific
- **Description:** Add `wikimind_claims`, `wikimind_contradictions`, `wikimind_decay_status`, `wikimind_maintenance_log` to the MCP server.
- **Acceptance criteria:** External agents can query claim freshness, view contradictions, and read maintenance history via MCP.
- **Model assignment:** agent

### [DONE] P6-03: YouTube transcript ingestion
- **Description:** Create `src-tauri/src/commands/youtube.rs`. Shell out to `youtube-transcript-api` (Python). Parse JSON transcript. Feed to the existing ingest pipeline as a text source.
- **Acceptance criteria:** Given a YouTube URL, the system fetches the transcript, creates wiki pages, and extracts claims. The raw transcript is stored in `raw/sources/`.
- **Model assignment:** agent

### [DONE] P6-04: GitHub repo ingestion
- **Description:** Create `src-tauri/src/commands/github.rs`. Clone or fetch a repo (shallow clone). Read README, docs/, and key source files. Feed to ingest pipeline.
- **Acceptance criteria:** Given a GitHub URL, the system clones the repo, reads documentation, creates entity/concept pages, and extracts claims about the project's architecture and APIs.
- **Model assignment:** agent

### [DONE] P6-05: MCP test suite
- **Description:** Write integration tests for all new MCP tools. Test against a test vault with known claims and contradictions.
- **Acceptance criteria:** `npm run mcp:test` passes with all new tools tested.
- **Model assignment:** agent

---

## Phase 7: 60-Day Run & Polish (Days 79–90+)

> **Goal:** Start the real-time autonomous run. Polish UI. Build evaluation dataset. Measure results.

### [DONE] P7-01: Seed evaluation dataset
- **Description:** Create 50+ labeled contradiction cases by: (a) ingesting contradictory sources deliberately, (b) manually labeling the ground truth for each, (c) storing in `eval/cases.jsonl`.
- **Acceptance criteria:** ≥50 cases with ground truth labels exist. Each case has: claim_a, claim_b, correct_verdict.
- **Model assignment:** human

### [DONE] P7-02: Run ensemble evaluation
- **Description:** Execute the evaluation harness against the labeled dataset. Record single-judge vs. ensemble FPR. Document the results.
- **Acceptance criteria:** `eval/results.jsonl` contains the comparison. The reduction percentage is calculated and displayed.
- **Model assignment:** either

### [DONE] P7-03: Start real-time 60-day run
- **Description:** Configure a real vault with production content. Set `time_warp_factor: 1`. Start the scheduler. Monitor for 60 days.
- **Acceptance criteria:** After 60 days, `jobs.jsonl` contains ≥60 daily decay scans, ~17 re-verification runs, ~9 ensemble runs, ≥2 health reports. The dashboard shows "Running for 60+ days".
- **Model assignment:** human

### [DONE] P7-04: Final UI polish
- **Description:** Apply `frontend_skills/Frontend_Skill.md` design principles to the Maintenance dashboard. Ensure the design is distinctive, not templated. Add micro-animations for state transitions.
- **Acceptance criteria:** The dashboard feels premium. Freshness state transitions animate smoothly. The design passes the "not AI-generated default" test from the Frontend Skill.
- **Model assignment:** either

### [DONE] P7-05: Write `00_CORE_PHILOSOPHY.md`
- **Description:** Create the project's core philosophy document in `docs/00_CORE_PHILOSOPHY.md`. Articulate the principle: "Compile knowledge, then continuously determine which parts may no longer be true and re-check them without requiring a human to remember."
- **Acceptance criteria:** Document is concise (<500 words), opinionated, and captures the decay-first philosophy.
- **Model assignment:** human

### [DONE] P7-06: Verify desktop packaging
- **Description:** Build .msi (Windows), verify it installs correctly, launches, creates a project, ingests a PDF, extracts claims, runs a maintenance cycle.
- **Acceptance criteria:** End-to-end workflow works from a fresh install.
- **Model assignment:** human
