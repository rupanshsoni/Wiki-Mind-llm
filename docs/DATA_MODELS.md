# WikiMind — Data Models

Exact schemas for frontmatter, database tables (where applicable), API signatures, and MCP tool signatures.

---

## 1. Frontmatter Schemas

### 1.1 Claim (`wiki/claims/*.md`)

```yaml
---
# Required fields
title: "string"                          # Atomic claim text (the assertion itself)
type: claim                              # Fixed literal
confidence: 0.82                         # float [0.0, 1.0] — current base confidence
source_count: 3                          # int — number of independent corroborating sources
last_verified: "2026-06-15"              # ISO 8601 date — last re-verification
verification_count: 4                    # int — total re-verifications performed
contradiction_count: 1                   # int — number of unresolved contradictions
freshness_state: aging                   # enum: fresh | aging | stale | decayed
date: "2026-04-01"                       # ISO 8601 date — claim creation date
tags: [llm, gpt-4, architecture]         # string[] — topic tags

# Optional fields
domain_volatility: high                  # enum: low | medium | high — decay rate modifier
description: "string"                    # One-sentence summary for search/tooltips

# Provenance
sources:                                 # Array of source references
  - path: "raw/sources/paper.pdf"        # Relative path to source document
    page: 12                             # Optional: page number in PDF
    excerpt: "quoted text from source"   # The exact text supporting this claim
    verified_at: "2026-06-15"            # When this source was last checked
    url: "https://..."                   # Optional: original URL for web sources

# Relationships
parent_concepts:                         # Wiki pages this claim belongs to
  - "concepts/gpt-4.md"
  - "concepts/large-language-models.md"
contradictions:                          # Linked contradiction pages
  - "contradictions/gpt4-param-dispute.md"

# History (bi-temporal, ported from obsidian-second-brain pattern)
history:
  - date: "2026-04-01"                   # When this event occurred
    confidence: 0.70                     # Confidence at that point
    event: initial_extraction            # enum: initial_extraction | corroboration |
                                         #   contradiction_found | contradiction_resolved |
                                         #   re_verification | manual_update | decay_update
    source: "paper.pdf"                  # What triggered the change
    note: "Optional human-readable note" # Context
---

## Claim Content

Prose explanation of the claim with context, caveats, and cross-references.
Follows the same writing standards as concept/entity pages.
```

### 1.2 Contradiction (`wiki/contradictions/*.md`)

```yaml
---
# Required fields
title: "string"                          # Short description of the disagreement
type: contradiction                      # Fixed literal
status: open                             # enum: open | under_review | resolved | escalated
date: "2026-06-10"                       # ISO 8601 date — when detected
tags: [llm, gpt-4]                       # string[]

# The competing claims
claims:
  - path: "claims/gpt4-1.8t-params.md"  # Relative path to claim A
    position: "1.8 trillion parameters"  # Claim A's assertion (human-readable)
  - path: "claims/gpt4-1.76t-params.md" # Relative path to claim B
    position: "1.76 trillion parameters" # Claim B's assertion

# Judge ensemble votes (populated after ensemble runs)
judge_votes:
  - judge_id: "judge-1"                 # Stable identifier
    model: "gpt-4o"                      # LLM model used
    verdict: accept_a                    # enum: accept_a | accept_b | merge |
                                         #   needs_evidence | escalate
    reasoning: "string"                  # Judge's explanation
    confidence: 0.9                      # float [0.0, 1.0]
    voted_at: "2026-06-16T03:15:00Z"     # ISO 8601 datetime

# Resolution (populated when resolved)
resolution_method: ensemble_majority     # enum: single_judge | ensemble_majority |
                                         #   ensemble_unanimous | human | auto_merge
resolution: "string"                     # Human-readable resolution description
resolved_at: "2026-06-16"               # ISO 8601 date
resolved_by: ensemble                    # enum: ensemble | human

# Optional
description: "string"                    # Extended context
new_evidence: "string"                   # Evidence found during re-research
---
```

### 1.3 Concept (`wiki/concepts/*.md`) — Extended

```yaml
---
# Existing fields (kept as-is)
title: "string"
description: "string"
date: "2026-03-15"
tags: [topic1, topic2]

# New WikiMind fields
type: concept                            # Explicit type tag
claim_count: 12                          # int — linked claims in claims/
stale_claim_count: 2                     # int — claims in stale/decayed state
avg_confidence: 0.78                     # float — mean confidence of linked claims
last_audited: "2026-07-01"              # ISO 8601 date — last maintenance pass
---
```

### 1.4 Entity (`wiki/entities/*.md`) — Extended

```yaml
---
# Existing fields (kept as-is)
title: "string"
description: "string"
date: "2026-03-15"
tags: [entity-type, topic]

# New WikiMind fields
type: entity
claim_count: 8
stale_claim_count: 1
avg_confidence: 0.85
last_audited: "2026-07-01"
---
```

---

## 2. Internal Data Files

### 2.1 Schedule Configuration (`.wikimind/schedule.json`)

```json
{
  "enabled": true,
  "time_warp_factor": 1,
  "jobs": {
    "decay_scan": {
      "cron": "0 3 * * *",
      "description": "Nightly: compute decay, flag stale claims",
      "max_claims_per_run": 50,
      "enabled": true
    },
    "re_verification": {
      "cron": "0 4 * * 1,4",
      "description": "Twice weekly: re-research top stale claims",
      "max_claims_per_run": 10,
      "web_search_budget": 20,
      "enabled": true
    },
    "contradiction_resolution": {
      "cron": "0 5 * * 3",
      "description": "Weekly: run ensemble on open contradictions",
      "max_contradictions_per_run": 5,
      "enabled": true
    },
    "health_report": {
      "cron": "0 6 1 * *",
      "description": "Monthly: full vault health + decay statistics",
      "emit_report": true,
      "enabled": true
    }
  },
  "decay_params": {
    "lambda_0": 0.01,
    "alpha": 0.3,
    "beta": 0.5,
    "volatility_multipliers": {
      "low": 0.5,
      "medium": 1.0,
      "high": 2.0
    },
    "freshness_thresholds": {
      "fresh": 0.7,
      "aging": 0.4,
      "stale": 0.2
    }
  },
  "ensemble": {
    "judges": [
      {
        "id": "judge-1",
        "provider": "openai",
        "model": "gpt-4o",
        "api_key_env": "OPENAI_API_KEY"
      },
      {
        "id": "judge-2",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "api_key_env": "ANTHROPIC_API_KEY"
      },
      {
        "id": "judge-3",
        "provider": "google",
        "model": "gemini-2.5-pro",
        "api_key_env": "GOOGLE_API_KEY"
      }
    ],
    "fallback_to_single_judge": true,
    "escalation_threshold": 0.6
  },
  "api_budget": {
    "monthly_cap_usd": 10.0,
    "current_month_spent_usd": 0.0,
    "reset_day": 1
  }
}
```

### 2.2 Job Log Entry (`.wikimind/maintenance/jobs.jsonl`)

Each line is a JSON object:

```json
{
  "job_id": "maint_2026-07-10_03:00:00",
  "job_type": "decay_scan",
  "started_at": "2026-07-10T03:00:00Z",
  "completed_at": "2026-07-10T03:00:47Z",
  "status": "completed",
  "time_warp_factor": 1,
  "metrics": {
    "claims_scanned": 247,
    "fresh_count": 180,
    "aging_count": 42,
    "stale_count": 20,
    "decayed_count": 5,
    "claims_reverified": 0,
    "contradictions_found": 0,
    "contradictions_resolved": 0,
    "pages_rewritten": 0,
    "api_calls": 0,
    "api_cost_usd": 0.0
  },
  "errors": [],
  "note": ""
}
```

### 2.3 Evaluation Case (`.wikimind/maintenance/eval/cases.jsonl`)

```json
{
  "case_id": "eval_001",
  "claim_a": {
    "path": "claims/gpt4-1.8t-params.md",
    "text": "GPT-4 has 1.8 trillion parameters"
  },
  "claim_b": {
    "path": "claims/gpt4-1.76t-params.md",
    "text": "GPT-4 has 1.76 trillion parameters"
  },
  "new_evidence": "...",
  "ground_truth_verdict": "merge",
  "ground_truth_reasoning": "Both are approximations of the same value",
  "labeled_by": "human",
  "labeled_at": "2026-07-15T10:00:00Z"
}
```

### 2.4 Evaluation Result (`.wikimind/maintenance/eval/results.jsonl`)

```json
{
  "run_id": "eval_run_2026-07-15",
  "run_at": "2026-07-15T12:00:00Z",
  "total_cases": 52,
  "single_judge": {
    "judge_id": "judge-1",
    "correct": 40,
    "false_positive": 8,
    "false_negative": 4,
    "fpr": 0.167
  },
  "ensemble": {
    "correct": 45,
    "false_positive": 4,
    "false_negative": 3,
    "fpr": 0.082
  },
  "fpr_reduction_pct": 50.9,
  "notes": "Ensemble reduced false-positive rewrites by 50.9% vs single-judge"
}
```

### 2.5 History Diff (`.wikimind/history/{slug}_{timestamp}.diff`)

Standard unified diff format:

```diff
--- a/wiki/claims/gpt4-1.8t-params.md
+++ b/wiki/claims/gpt4-1.8t-params.md
@@ -3,3 +3,3 @@
-confidence: 0.70
+confidence: 0.82
-source_count: 1
+source_count: 3
-freshness_state: stale
+freshness_state: aging
```

---

## 3. API Signatures

All endpoints are under `/api/v1` on `http://127.0.0.1:19828`.

### 3.1 Existing Endpoints (renamed, kept as-is)

These retain their current behavior with the path prefix unchanged:

- `GET /api/v1/health`
- `GET /api/v1/projects`
- `GET /api/v1/projects/:id/files`
- `GET /api/v1/projects/:id/files/content`
- `GET /api/v1/projects/:id/reviews`
- `GET /api/v1/projects/:id/search`
- `POST /api/v1/projects/:id/chat`
- `GET /api/v1/projects/:id/graph`
- `POST /api/v1/projects/:id/rescan`

### 3.2 New Endpoints

#### `GET /api/v1/projects/:id/claims`

List claims with optional filtering.

**Query parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `freshness` | string | `all` | Filter: `fresh`, `aging`, `stale`, `decayed`, `all` |
| `sort` | string | `freshness` | Sort by: `freshness`, `confidence`, `last_verified`, `contradiction_count` |
| `limit` | int | 50 | Max results |
| `offset` | int | 0 | Pagination offset |

**Response:**
```json
{
  "claims": [
    {
      "path": "wiki/claims/gpt4-params.md",
      "title": "GPT-4 has 1.8T parameters",
      "confidence": 0.82,
      "freshness_state": "aging",
      "source_count": 3,
      "last_verified": "2026-06-15",
      "contradiction_count": 1
    }
  ],
  "total": 247,
  "freshness_distribution": {
    "fresh": 180,
    "aging": 42,
    "stale": 20,
    "decayed": 5
  }
}
```

#### `GET /api/v1/projects/:id/claims/:claim_path`

Read a single claim with full metadata including computed decay.

**Response:**
```json
{
  "path": "wiki/claims/gpt4-params.md",
  "title": "GPT-4 has 1.8T parameters",
  "content": "...",
  "confidence": 0.82,
  "computed_confidence": 0.726,
  "freshness_state": "fresh",
  "source_count": 3,
  "last_verified": "2026-06-15",
  "contradiction_count": 1,
  "sources": [...],
  "parent_concepts": [...],
  "contradictions": [...],
  "history": [...]
}
```

#### `GET /api/v1/projects/:id/contradictions`

List contradictions with optional status filter.

**Query parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | `open` | Filter: `open`, `under_review`, `resolved`, `escalated`, `all` |
| `limit` | int | 50 | Max results |

**Response:**
```json
{
  "contradictions": [
    {
      "path": "wiki/contradictions/gpt4-param-dispute.md",
      "title": "GPT-4 Parameter Count Dispute",
      "status": "open",
      "claims": [
        { "path": "claims/gpt4-1.8t.md", "position": "1.8T" },
        { "path": "claims/gpt4-1.76t.md", "position": "1.76T" }
      ],
      "judge_votes_count": 0,
      "date": "2026-06-10"
    }
  ],
  "total": 5
}
```

#### `GET /api/v1/projects/:id/maintenance/status`

Scheduler and decay overview.

**Response:**
```json
{
  "scheduler_enabled": true,
  "scheduler_paused": false,
  "time_warp_factor": 1,
  "next_job": {
    "type": "decay_scan",
    "scheduled_at": "2026-07-11T03:00:00Z"
  },
  "total_claims": 247,
  "freshness_distribution": { "fresh": 180, "aging": 42, "stale": 20, "decayed": 5 },
  "running_since": "2026-05-01T00:00:00Z",
  "days_running": 70,
  "total_jobs_completed": 142,
  "api_budget": {
    "monthly_cap_usd": 10.0,
    "current_month_spent_usd": 3.45
  }
}
```

#### `GET /api/v1/projects/:id/maintenance/jobs`

Job history.

**Query parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | int | 20 | Max results |
| `job_type` | string | `all` | Filter by job type |

**Response:**
```json
{
  "jobs": [...],
  "total": 142
}
```

#### `POST /api/v1/projects/:id/maintenance/run`

Manually trigger a maintenance job.

**Request body:**
```json
{
  "job_type": "decay_scan"
}
```

**Response:**
```json
{
  "job_id": "maint_2026-07-10_15:30:00",
  "status": "started"
}
```

---

## 4. MCP Tool Signatures

All tools use the MCP SDK `CallToolRequest` schema. Below are the `inputSchema` definitions for each new tool.

### 4.1 `wikimind_guide`

```json
{
  "name": "wikimind_guide",
  "description": "Get started with WikiMind. Explains the knowledge vault, claim-decay model, and available tools.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

### 4.2 `wikimind_create`

```json
{
  "name": "wikimind_create",
  "description": "Create a new wiki page (concept, entity, claim, or comparison) with validated frontmatter.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "Project identifier. Defaults to 'current'." },
      "path": { "type": "string", "description": "Wiki-relative path, e.g. 'concepts/attention.md' or 'claims/gpt4-params.md'." },
      "title": { "type": "string", "description": "Page title." },
      "content": { "type": "string", "description": "Full page content including frontmatter." },
      "tags": { "type": "array", "items": { "type": "string" }, "description": "Topic tags." }
    },
    "required": ["path", "title", "content"],
    "additionalProperties": false
  }
}
```

### 4.3 `wikimind_edit`

```json
{
  "name": "wikimind_edit",
  "description": "Edit an existing wiki page. Preserves edit history as a diff.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "path": { "type": "string", "description": "Wiki-relative path to the page." },
      "content": { "type": "string", "description": "New full content of the page." }
    },
    "required": ["path", "content"],
    "additionalProperties": false
  }
}
```

### 4.4 `wikimind_append`

```json
{
  "name": "wikimind_append",
  "description": "Append content to an existing wiki page without replacing existing content.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "path": { "type": "string" },
      "content": { "type": "string", "description": "Content to append." }
    },
    "required": ["path", "content"],
    "additionalProperties": false
  }
}
```

### 4.5 `wikimind_delete`

```json
{
  "name": "wikimind_delete",
  "description": "Delete a wiki page. Logs the deletion in the operation log.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "path": { "type": "string" }
    },
    "required": ["path"],
    "additionalProperties": false
  }
}
```

### 4.6 `wikimind_lint`

```json
{
  "name": "wikimind_lint",
  "description": "Run deterministic hygiene checks: frontmatter validation, orphan detection, stale claim flagging, contradiction consistency.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "path": { "type": "string", "description": "Page path to lint, or '*' for full vault." },
      "fix": { "type": "boolean", "description": "Auto-fix safe issues. Defaults to false." }
    },
    "required": ["path"],
    "additionalProperties": false
  }
}
```

### 4.7 `wikimind_claims`

```json
{
  "name": "wikimind_claims",
  "description": "List claims with freshness filtering and sorting. Returns confidence scores and decay status.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "freshness": { "type": "string", "enum": ["fresh", "aging", "stale", "decayed", "all"], "description": "Filter by freshness state. Defaults to 'all'." },
      "sort": { "type": "string", "enum": ["freshness", "confidence", "last_verified", "contradiction_count"], "description": "Sort field. Defaults to 'freshness'." },
      "limit": { "type": "number", "description": "Max results. Defaults to 50." }
    },
    "additionalProperties": false
  }
}
```

### 4.8 `wikimind_contradictions`

```json
{
  "name": "wikimind_contradictions",
  "description": "List contradictions between claims with judge vote status and resolution.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "status": { "type": "string", "enum": ["open", "under_review", "resolved", "escalated", "all"], "description": "Filter by status. Defaults to 'open'." },
      "limit": { "type": "number" }
    },
    "additionalProperties": false
  }
}
```

### 4.9 `wikimind_decay_status`

```json
{
  "name": "wikimind_decay_status",
  "description": "Get vault-wide decay statistics: total claims, freshness distribution, scheduler status, days running.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

### 4.10 `wikimind_maintenance_log`

```json
{
  "name": "wikimind_maintenance_log",
  "description": "Read recent maintenance job history.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "limit": { "type": "number", "description": "Max entries. Defaults to 20." },
      "job_type": { "type": "string", "description": "Filter by job type." }
    },
    "additionalProperties": false
  }
}
```

---

## 5. Tauri Command Signatures

New Tauri commands registered in `lib.rs`:

```rust
// Claims
#[tauri::command]
async fn maintenance_list_claims(
    app: tauri::AppHandle,
    project_id: String,
    freshness: Option<String>,  // "fresh" | "aging" | "stale" | "decayed" | "all"
    sort: Option<String>,       // "freshness" | "confidence" | "last_verified"
    limit: Option<usize>,
) -> Result<ClaimsListResponse, String>;

#[tauri::command]
async fn maintenance_get_claim(
    app: tauri::AppHandle,
    project_id: String,
    claim_path: String,
) -> Result<ClaimDetail, String>;

#[tauri::command]
async fn maintenance_create_claim(
    app: tauri::AppHandle,
    project_id: String,
    claim: CreateClaimRequest,
) -> Result<ClaimDetail, String>;

// Contradictions
#[tauri::command]
async fn maintenance_list_contradictions(
    app: tauri::AppHandle,
    project_id: String,
    status: Option<String>,
    limit: Option<usize>,
) -> Result<ContradictionsListResponse, String>;

// Decay
#[tauri::command]
fn maintenance_decay_status(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<DecayStatusResponse, String>;

// Scheduler
#[tauri::command]
fn maintenance_scheduler_status(
    app: tauri::AppHandle,
) -> Result<SchedulerStatus, String>;

#[tauri::command]
async fn maintenance_run_job(
    app: tauri::AppHandle,
    project_id: String,
    job_type: String,
) -> Result<String, String>;  // Returns job_id

#[tauri::command]
fn maintenance_pause_scheduler(
    app: tauri::AppHandle,
) -> Result<bool, String>;

#[tauri::command]
fn maintenance_resume_scheduler(
    app: tauri::AppHandle,
) -> Result<bool, String>;

// Job history
#[tauri::command]
fn maintenance_job_history(
    app: tauri::AppHandle,
    project_id: String,
    limit: Option<usize>,
    job_type: Option<String>,
) -> Result<Vec<JobLogEntry>, String>;
```

### Response Types (Rust structs)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimsListResponse {
    claims: Vec<ClaimSummary>,
    total: usize,
    freshness_distribution: FreshnessDistribution,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimSummary {
    path: String,
    title: String,
    confidence: f64,
    computed_confidence: f64,
    freshness_state: String,
    source_count: usize,
    last_verified: String,
    contradiction_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimDetail {
    path: String,
    title: String,
    content: String,
    confidence: f64,
    computed_confidence: f64,
    freshness_state: String,
    source_count: usize,
    last_verified: String,
    verification_count: usize,
    contradiction_count: usize,
    domain_volatility: String,
    sources: Vec<SourceReference>,
    parent_concepts: Vec<String>,
    contradictions: Vec<String>,
    history: Vec<HistoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FreshnessDistribution {
    fresh: usize,
    aging: usize,
    stale: usize,
    decayed: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecayStatusResponse {
    total_claims: usize,
    freshness_distribution: FreshnessDistribution,
    scheduler_enabled: bool,
    scheduler_paused: bool,
    time_warp_factor: u32,
    next_job: Option<NextJob>,
    running_since: Option<String>,
    days_running: u64,
    total_jobs_completed: usize,
    api_budget: ApiBudget,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobLogEntry {
    job_id: String,
    job_type: String,
    started_at: String,
    completed_at: Option<String>,
    status: String,
    time_warp_factor: u32,
    metrics: JobMetrics,
    errors: Vec<String>,
}
```

---

## 6. Judge Prompt Template

Used by the ensemble module when evaluating a contradiction:

```
You are an expert fact-checker evaluating a factual disagreement between two claims
in a knowledge base. Your job is to determine which claim is more likely correct based
on the evidence provided.

## CLAIM A
Title: {{claim_a_title}}
Text: {{claim_a_text}}
Sources ({{claim_a_source_count}} total):
{{#each claim_a_sources}}
  - {{this.path}}{{#if this.page}}, p.{{this.page}}{{/if}}: "{{this.excerpt}}"
    Last verified: {{this.verified_at}}
{{/each}}
Confidence: {{claim_a_confidence}}
Last verified: {{claim_a_last_verified}}

## CLAIM B
Title: {{claim_b_title}}
Text: {{claim_b_text}}
Sources ({{claim_b_source_count}} total):
{{#each claim_b_sources}}
  - {{this.path}}{{#if this.page}}, p.{{this.page}}{{/if}}: "{{this.excerpt}}"
    Last verified: {{this.verified_at}}
{{/each}}
Confidence: {{claim_b_confidence}}
Last verified: {{claim_b_last_verified}}

## ADDITIONAL EVIDENCE (from re-research)
{{new_evidence}}

## EVALUATION CRITERIA
Consider:
1. Source authority: academic papers > official documentation > news articles > blog posts
2. Recency: more recent sources are generally more authoritative for fast-moving domains
3. Independence: claims corroborated by independent sources are stronger
4. Precision: determine if the contradiction is genuine or apparent (rounding, different contexts, different time periods)
5. Scope: one claim may be a subset or approximation of the other

## REQUIRED OUTPUT
Respond with a single JSON object (no markdown fencing):
{
  "verdict": "accept_a" | "accept_b" | "merge" | "needs_evidence" | "escalate",
  "reasoning": "2-3 sentence explanation of your decision",
  "confidence": <float 0.0 to 1.0 — how confident you are in this verdict>
}

Definitions:
- accept_a: Claim A is correct; Claim B should be deprecated or corrected
- accept_b: Claim B is correct; Claim A should be deprecated or corrected
- merge: Both claims are compatible (e.g., rounding, different contexts); they should be merged
- needs_evidence: Cannot determine without additional research; request a deeper investigation
- escalate: Genuinely ambiguous; requires human judgment to resolve
```
