# WikiMind — Risks

What is likely to break or be harder than it looks.

---

## R1: LLM-Judge Ensemble Cost and Latency

### Risk
Each contradiction resolution costs 3 parallel LLM API calls. At scale, this creates both financial and latency pressure.

### Analysis

**Cost modeling:**

| Scenario | Claims | Weekly contradiction rate | Contradictions/week | API calls/week | Cost/week (avg $0.03/call) |
|---|---|---|---|---|---|
| Small vault | 100 | 2% | 2 | 6 | $0.18 |
| Medium vault | 500 | 2% | 10 | 30 | $0.90 |
| Large vault | 2,000 | 2% | 40 | 120 | $3.60 |
| Very large vault | 10,000 | 1% | 100 | 300 | $9.00 |

At even the "very large" scale, weekly ensemble costs are ~$9. The default monthly budget cap of $10 is adequate for small/medium vaults but will throttle large vaults aggressively. Users with large vaults need to increase the cap or reduce the contradiction resolution frequency.

**Latency modeling:**

Three parallel LLM calls, each 2–8 seconds depending on model and prompt length. Total wall-clock time per contradiction: 3–10 seconds (parallel). Per batch of 5 contradictions: 15–50 seconds. Acceptable for a background job running at 3 AM, but the "Run Ensemble" button in the UI should show a progress indicator.

### Mitigations
1. **Budget cap with automatic pause.** The scheduler stops automated ensemble runs when the monthly cap is reached. Users are notified via the dashboard.
2. **Batch processing.** Contradictions are batched (default 5 per run) to amortize startup costs.
3. **Single-judge fallback.** If only one API key is configured, the system falls back to single-judge mode with a logged warning. This eliminates the diversity benefit but avoids blocking all contradiction resolution.
4. **Progressive escalation.** Simple contradictions (e.g., rounding differences) can be auto-resolved by heuristics before invoking the ensemble, reducing unnecessary API calls.
5. **Cost tracking in UI.** The Settings panel shows current month spending vs. cap, so users have full visibility.

---

## R2: Decay Tuning Without Real Longitudinal Data

### Risk
The decay formula has 5 tunable parameters (`λ₀`, `α`, `β`, volatility multipliers, freshness thresholds). Choosing good defaults requires longitudinal data about how often real claims actually become stale — data we don't have at project start.

### Analysis
The default parameters are derived from reasoning about reasonable half-lives:
- `λ₀ = 0.01` gives a half-life of ~69 days with no modifiers. This means an unverified, single-source claim in a medium-volatility domain drops to 50% confidence in ~69 days. Is this too fast? Too slow? We won't know until the system has been running.

**What could go wrong:**
- **Too fast:** Claims decay to "stale" within weeks, generating excessive re-verification work and API costs. The system cries wolf.
- **Too slow:** Claims sit at "fresh" for months when the underlying facts have changed. The system doesn't catch staleness in time.
- **Wrong volatility assignments:** If a user marks AI research as "low" volatility, claims about rapidly-changing APIs will decay too slowly.

### Mitigations
1. **All parameters are user-configurable.** The Settings UI exposes every decay parameter. Advanced users can tune to their domain.
2. **Domain volatility is per-claim, not global.** Users can override volatility for individual claims, and the claim extraction prompt includes a volatility hint.
3. **Time-warp simulation.** During development, accelerated simulation lets us observe months of decay behavior in hours. This gives fast feedback on parameter choices.
4. **Dashboard feedback loop.** The maintenance dashboard shows decay curves and job activity. If too many claims are going stale (system is too aggressive) or too few (too lenient), the user can visually identify the problem and adjust parameters.
5. **Conservative defaults.** The initial parameters err on the side of slower decay. It's better to miss some staleness initially than to generate excessive false-stale alerts that train the user to ignore the system.

---

## R3: 60-Day Real Run vs. Accelerated Simulation

### Risk
The resume claims "Vault has run autonomously for 60+ days." This requires 60 actual calendar days of the scheduler operating. There is a temptation to present an accelerated simulation as a real 60-day run.

### Analysis

**What "60 days running" actually proves:**
- The scheduler is reliable over extended periods (handles app restarts, crashes, edge cases)
- The decay formula produces useful results with real-world claim churn
- The API budget doesn't blow up unexpectedly
- The maintenance pipeline doesn't corrupt the vault over time
- Edit history accumulates and remains navigable

**What accelerated simulation proves:**
- The pipeline logic works end-to-end
- The decay formula computes correctly at all time scales
- The ensemble aggregation handles diverse inputs
- But NOT that the system is reliable over 60 real days

### Approach (explicit, no deception)

1. **Development uses `time_warp_factor: 24`.** One hour = one simulated day. 3 days of testing = 72 simulated days. All logs and UI clearly label this as `[SIMULATED]`.

2. **Production uses `time_warp_factor: 1`.** The 60-day claim requires actually waiting 60 days with the scheduler running.

3. **The UI displays both metrics:**
   - "Simulated days: 72 (via 3 real days at 24x warp)" — during development
   - "Running for 63 real days (187 jobs completed)" — in production

4. **The `jobs.jsonl` log is the audit trail.** Anyone can verify the timestamps are real by checking the entries.

5. **If the 60-day run hasn't completed yet, the documentation says "running since [date], currently at [X] days."** It does not round up or project.

### Risk of failure during the 60-day run
- App crashes and the user doesn't reopen it for days → gap in the job log
- Windows Update reboots the machine → scheduler interruption
- API key expires → maintenance jobs fail silently

**Mitigation:** The scheduler logs interruptions. The dashboard shows gaps in the job timeline. The "days running" counter counts days with at least one successful job, not calendar days since first launch.

---

## R4: Claim Extraction Quality

### Risk
The post-ingest claim extraction step uses an LLM to identify atomic, verifiable assertions from wiki pages. LLMs may:
- Extract non-claims (opinions, definitions, trivial statements)
- Miss important claims
- Extract claims that are too broad or too narrow
- Hallucinate claims not present in the source

### Analysis
Claim extraction quality directly affects the entire system. Too many low-quality claims → noise in the decay system, wasted re-verification effort, meaningless confidence scores. Too few claims → the system has nothing to track.

### Mitigations
1. **Structured output.** The extraction prompt requires JSON output with specific fields, reducing format-related failures.
2. **Deduplication via vector search.** Even if the LLM extracts a redundant claim, the dedup step (similarity > 0.85) prevents duplicates.
3. **Human review for initial claims.** Extracted claims are queued in the Review tab for the first N extractions (configurable, default 20), so the user can calibrate quality.
4. **Iterative prompt refinement.** The extraction prompt is stored in a user-editable file, allowing domain-specific customization.
5. **Claim count limits.** The extraction step caps at 15 claims per page to prevent runaway extraction.

---

## R5: Multi-Provider API Key Management

### Risk
The judge ensemble requires API keys for 3 different LLM providers. Most users have 1-2 providers configured, not 3.

### Analysis
If only one provider is available, the ensemble cannot provide the cross-model error decorrelation that justifies its existence. Two providers is better but still limited. The claimed benefit of multi-model voting disappears with a single model.

### Mitigations
1. **Graceful degradation.** One key → single-judge mode (logged). Two keys → 2-judge mode (less reliable than 3, but better than 1). Three keys → full ensemble.
2. **Clear guidance in Settings.** The judge configuration UI explains why multiple providers matter and which free-tier options are available.
3. **Different models on the same provider.** As a fallback-fallback, users can configure 3 different models from the same provider (e.g., GPT-4o, GPT-4o-mini, GPT-3.5-turbo). This is suboptimal (correlated errors) but better than nothing.
4. **Evaluation harness measures the actual benefit.** The FPR comparison shows whether the configured ensemble is actually outperforming single-judge. If the improvement is marginal (same provider, similar models), the dashboard surfaces this.

---

## R6: Vault Size Scaling

### Risk
The decay scan iterates all `claims/*.md` files. For very large vaults (10,000+ claims), this becomes a performance concern.

### Analysis
- Reading YAML frontmatter from 10,000 files: ~2-5 seconds (filesystem I/O bound)
- Computing decay for 10,000 claims: ~1ms (pure math, negligible)
- Writing updated freshness states: only for changed claims, typically <5% per scan

### Mitigations
1. **Lazy computation.** Decay is computed on read, not stored. The nightly scan only updates `freshness_state` when it changes (most claims don't change state between scans).
2. **Frontmatter-only reads.** The scan reads only the YAML frontmatter header, not the full page content.
3. **Incremental scanning.** Claims that are `fresh` and far from any threshold can be skipped (their next state change is predictable).
4. **LanceDB indexing.** Claim metadata is also indexed in LanceDB for fast filtering and sorting.

---

## R7: Rename/Migration Breakage

### Risk
Renaming `.llm-wiki/` to `.wikimind/` and changing all branding may break existing user projects.

### Analysis
Users of the original `llm_wiki` repo have projects with `.llm-wiki/project.json`. After the rename, the app won't find these projects.

### Mitigations
1. **Dual-read migration.** On project open, check for both `.wikimind/project.json` and `.llm-wiki/project.json`. If only the old path exists, migrate by copying to the new path.
2. **One-time migration on first launch.** Scan known project paths and migrate automatically, with a notification.
3. **No data loss.** Migration copies, never deletes. The old `.llm-wiki/` directory remains until the user explicitly removes it.

---

## R8: Web Search Reliability for Re-Verification

### Risk
The re-verification pipeline relies on web search to find current evidence for stale claims. Web search APIs have rate limits, may return irrelevant results, or may be unavailable.

### Analysis
- **Tavily/SerpApi:** Paid, reliable, but subject to monthly quotas.
- **SearXNG:** Self-hosted, unlimited, but requires setup.
- **DuckDuckGo (free):** No API key needed, but rate-limited and less reliable for precise fact-checking queries.

### Mitigations
1. **Fallback chain.** Try configured search provider first. If it fails, fall back to the next configured provider. If all fail, skip re-verification for this claim and reschedule.
2. **Source URL validation.** Before web searching, check if the original source URLs still respond (HTTP HEAD). This catches simple cases without a search query.
3. **Search result caching.** Cache search results for 24 hours to avoid redundant queries for related claims.
4. **Graceful failure.** If re-verification cannot be completed, the claim remains in its current state. The job log records "re-verification skipped: no search results" rather than failing the entire job.

---

## R9: Front-End Complexity

### Risk
Adding a Maintenance dashboard (5 new panels), claim editor, and contradiction viewer significantly expands the frontend surface area. This could regress existing UI quality or slow development.

### Analysis
The existing frontend has 11 component directories plus stores. Adding a 12th directory (`maintenance/`) with ~7 components is a ~15% increase in frontend code. The risk is manageable but the new views must match the existing design quality.

### Mitigations
1. **Reuse existing UI patterns.** The claims list reuses the file tree component pattern. The contradictions panel reuses the review items pattern. The job history reuses the log viewer pattern.
2. **Recharts for charts.** One additional dependency (`recharts`) handles all chart rendering. No custom canvas drawing.
3. **Incremental delivery.** Phase 5 (dashboard) ships after Phase 4 (ensemble). The system is functional without the dashboard — it just lacks the monitoring UI.
4. **Apply `frontend_skills/Frontend_Skill.md` guidance.** The dashboard is designed as a distinctive view, not a templated data table.

---

## Risk Summary

| Risk | Severity | Probability | Impact | Primary Mitigation |
|---|---|---|---|---|
| R1: Ensemble cost/latency | Medium | Medium | Budget exceeded, slow jobs | Budget cap + batch processing |
| R2: Decay tuning | Medium | High | Too many/few stale alerts | Configurable params + dashboard feedback |
| R3: 60-day run honesty | Low | Low | Credibility loss | Explicit labeling of simulation vs. real |
| R4: Claim extraction quality | High | Medium | Noisy system, wasted effort | Dedup + human review + prompt iteration |
| R5: Multi-provider keys | Medium | High | Ensemble degrades to single-judge | Graceful degradation + clear guidance |
| R6: Vault scaling | Low | Low | Slow scans | Lazy computation + incremental scanning |
| R7: Migration breakage | Medium | Medium | Lost user projects | Dual-read migration |
| R8: Web search reliability | Medium | Medium | Re-verification fails | Fallback chain + graceful failure |
| R9: Frontend complexity | Medium | Medium | UI quality regression | Reuse patterns + incremental delivery |
