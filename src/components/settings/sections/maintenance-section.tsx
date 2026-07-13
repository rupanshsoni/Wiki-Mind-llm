import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import {
  Wrench,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  RotateCcw,
  Clock,
  Play,
  Pause,
  Save,
  Calendar,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { runDuplicateDetection } from "@/lib/dedup-runner"
import { addNotDuplicate } from "@/lib/dedup-storage"
import {
  enqueueMerge,
  cancelTask,
  retryTask,
  getQueue,
  getQueueSummary,
  resumeProcessing,
  groupKey,
  type DedupTask,
} from "@/lib/dedup-queue"
import type { DuplicateGroup } from "@/lib/dedup"

import { Users, Coins, TrendingUp, Sparkles, ClipboardList } from "lucide-react"

interface JobSchedule {
  name: string
  cron: string
  enabled: boolean
}

interface EnsembleScheduleConfig {
  judges: string[]
  fallback_to_single_judge: boolean
  escalation_threshold: number
}

interface ApiBudgetConfig {
  monthly_cap_usd: number
  current_month_spent_usd: number
  reset_day: number
  last_reset_month?: string
}

interface SchedulerConfig {
  time_warp_factor: number
  jobs: JobSchedule[]
  ensemble?: EnsembleScheduleConfig
  api_budget?: ApiBudgetConfig
}

interface GroupUiEntry {
  group: DuplicateGroup
  canonicalSlug: string
  /** Becomes true when the user marks the group as "not duplicates"
   *  in this session — the card transitions to skipped state. */
  skipped: boolean
}

interface EvalStats {
  judge_id: string
  correct: number
  false_positive: number
  false_negative: number
  fpr: number
}

interface EvalRun {
  run_id: string
  run_at: string
  total_cases: number
  single_judge: EvalStats
  ensemble: EvalStats
  fpr_reduction_pct: number
  notes: string
}

interface EvalResponse {
  total: number
  runs: EvalRun[]
}

/** Match a card to its task in the queue (if any) by slug-set. */
function findTaskForGroup(
  tasks: readonly DedupTask[],
  slugs: readonly string[],
): DedupTask | undefined {
  const key = groupKey(slugs)
  return tasks.find((t) => groupKey(t.group.slugs) === key)
}

export function MaintenanceSection() {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const judge1Config = useWikiStore((s) => s.judge1Config)
  const judge2Config = useWikiStore((s) => s.judge2Config)
  const judge3Config = useWikiStore((s) => s.judge3Config)
  
  const setJudge1Config = useWikiStore((s) => s.setJudge1Config)
  const setJudge2Config = useWikiStore((s) => s.setJudge2Config)
  const setJudge3Config = useWikiStore((s) => s.setJudge3Config)

  const project = useWikiStore((s) => s.project)

  const [activeSubTab, setActiveSubTab] = useState<"dedup" | "scheduler" | "ensemble" | "eval">("dedup")

  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupUiEntry[]>([])
  const [scanCompleted, setScanCompleted] = useState(false)

  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  // Local judge forms drafts
  const [j1, setJ1] = useState(judge1Config)
  const [j2, setJ2] = useState(judge2Config)
  const [j3, setJ3] = useState(judge3Config)
  const [savingJudges, setSavingJudges] = useState(false)

  // Eval states
  const [runningEval, setRunningEval] = useState(false)
  const [evalResults, setEvalResults] = useState<EvalResponse | null>(null)

  const loadSchedulerStatus = useCallback(async () => {
    try {
      const status = await invoke<{
        paused: boolean
        time_warp_factor: number
        jobs: JobSchedule[]
        ensemble?: EnsembleScheduleConfig
        api_budget?: ApiBudgetConfig
      }>("maintenance_scheduler_status")
      setIsPaused(status.paused)
      setSchedulerConfig({
        time_warp_factor: status.time_warp_factor,
        jobs: status.jobs,
        ensemble: status.ensemble,
        api_budget: status.api_budget,
      })
    } catch (err) {
      console.error("Failed to load scheduler status:", err)
    }
  }, [])

  const loadEvalResults = useCallback(async () => {
    if (!project) return
    try {
      const results = await invoke<EvalResponse>("maintenance_get_eval_results", {
        projectPath: project.path,
      })
      setEvalResults(results)
    } catch (err) {
      console.error("Failed to load eval results:", err)
    }
  }, [project])

  useEffect(() => {
    loadSchedulerStatus()
    loadEvalResults()
  }, [loadSchedulerStatus, loadEvalResults])

  // Sync draft judge states when store changes (e.g. on load)
  useEffect(() => {
    setJ1(judge1Config)
    setJ2(judge2Config)
    setJ3(judge3Config)
  }, [judge1Config, judge2Config, judge3Config])

  const handleSaveConfig = async () => {
    if (!schedulerConfig) return
    try {
      setSavingConfig(true)
      await invoke("maintenance_update_schedule_config", { newConfig: schedulerConfig })
      alert("Scheduler & budget configuration saved!")
    } catch (err) {
      console.error("Failed to save scheduler config:", err)
      alert("Failed to save: " + err)
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSaveJudges = async () => {
    try {
      setSavingJudges(true)
      const { saveJudge1Config, saveJudge2Config, saveJudge3Config } = await import("@/lib/project-store")
      await saveJudge1Config(j1)
      await saveJudge2Config(j2)
      await saveJudge3Config(j3)
      setJudge1Config(j1)
      setJudge2Config(j2)
      setJudge3Config(j3)
      alert("Ensemble Judge configurations saved!")
    } catch (err) {
      console.error("Failed to save judge configs:", err)
      alert("Failed to save judge configs: " + err)
    } finally {
      setSavingJudges(false)
    }
  }

  const handleRunEval = async () => {
    if (!project) return
    try {
      setRunningEval(true)
      await invoke("maintenance_run_eval", {
        projectPath: project.path,
      })
      await loadEvalResults()
      alert("Evaluation Run Completed!")
    } catch (err) {
      console.error("Failed to run evaluation harness:", err)
      alert("Failed to run evaluation: " + err)
    } finally {
      setRunningEval(false)
    }
  }

  const handleTogglePause = async () => {
    try {
      if (isPaused) {
        await invoke("maintenance_resume_scheduler")
        setIsPaused(false)
      } else {
        await invoke("maintenance_pause_scheduler")
        setIsPaused(true)
      }
    } catch (err) {
      console.error("Failed to toggle pause:", err)
    }
  }

  // Poll the queue at 1Hz
  const [tasks, setTasks] = useState<readonly DedupTask[]>([])
  const [queueSummary, setQueueSummary] = useState(() => getQueueSummary())
  useEffect(() => {
    setTasks([...getQueue()])
    setQueueSummary(getQueueSummary())
    const id = setInterval(() => {
      setTasks([...getQueue()])
      setQueueSummary(getQueueSummary())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const llmReady = hasUsableLlm(llmConfig)
  const projectReady = !!project

  const handleScan = useCallback(async () => {
    if (!project) return
    setScanning(true)
    setScanError(null)
    setGroups([])
    setScanCompleted(false)
    try {
      const detected = await runDuplicateDetection(project.path, llmConfig)
      setGroups(
        detected.map((g) => ({
          group: g,
          canonicalSlug: g.slugs[0],
          skipped: false,
        })),
      )
      setScanCompleted(true)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [project, llmConfig])

  const handleCanonicalChange = useCallback(
    (idx: number, slug: string) => {
      setGroups((prev) =>
        prev.map((g, i) => (i === idx ? { ...g, canonicalSlug: slug } : g)),
      )
    },
    [],
  )

  const handleEnqueue = useCallback(
    async (entry: GroupUiEntry) => {
      if (!project) return
      try {
        await enqueueMerge(project.id, entry.group, entry.canonicalSlug)
        setTasks([...getQueue()])
        setQueueSummary(getQueueSummary())
      } catch (err) {
        console.error("[Maintenance] enqueue failed:", err)
      }
    },
    [project],
  )

  const handleCancel = useCallback(async (taskId: string) => {
    await cancelTask(taskId)
    setTasks([...getQueue()])
    setQueueSummary(getQueueSummary())
  }, [])

  const handleRetry = useCallback(async (taskId: string) => {
    await retryTask(taskId)
    setTasks([...getQueue()])
    setQueueSummary(getQueueSummary())
  }, [])

  const handleResumeRestoredQueue = useCallback(() => {
    resumeProcessing()
    setTasks([...getQueue()])
    setQueueSummary(getQueueSummary())
  }, [])

  const handleNotDuplicate = useCallback(
    async (idx: number) => {
      if (!project) return
      const entry = groups[idx]
      if (!entry) return
      try {
        await addNotDuplicate(project.path, entry.group.slugs)
        setGroups((prev) =>
          prev.map((g, i) => (i === idx ? { ...g, skipped: true } : g)),
        )
      } catch (err) {
        console.error("[Maintenance] addNotDuplicate failed:", err)
      }
    },
    [project, groups],
  )

  const [recentlyMergedKeys, setRecentlyMergedKeys] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    setRecentlyMergedKeys((prev) => {
      const currentKeys = new Set(tasks.map((t) => groupKey(t.group.slugs)))
      let changed = false
      const next = new Set(prev)
      for (const g of groups) {
        const k = groupKey(g.group.slugs)
        const wasInFlight = lastSeenTaskKeysRef.current.has(k)
        if (wasInFlight && !currentKeys.has(k) && !next.has(k)) {
          next.add(k)
          changed = true
        }
      }
      lastSeenTaskKeysRef.current = currentKeys
      return changed ? next : prev
    })
  }, [tasks])
  const lastSeenTaskKeysRef = useRefInit<Set<string>>(() => new Set())

  const pendingPositionByTaskId = useMemo(() => {
    const positions = new Map<string, number>()
    let position = 0
    for (const t of tasks) {
      if (t.status === "pending") {
        positions.set(t.id, position)
        position++
      }
    }
    return positions
  }, [tasks])

  const subTabs = [
    { id: "dedup", label: "Deduplication", icon: Wrench },
    { id: "scheduler", label: "Scheduler & Budget", icon: Calendar },
    { id: "ensemble", label: "Judge Ensemble", icon: Users },
    { id: "eval", label: "Evaluation Harness", icon: TrendingUp },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.maintenance.title", { defaultValue: "Maintenance" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Autonomous maintenance, multi-voter LLM judges, fact check auditing, and concepts deduplication.
        </p>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex border-b border-border/60 gap-4 mb-4">
        {subTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeSubTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-1 pb-3 text-xs font-semibold transition-all duration-200 ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Active Tab Panel */}
      <div className="space-y-6">
        
        {/* Tab 1: Deduplication */}
        {activeSubTab === "dedup" && (
          <div className="space-y-6">
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">
                  {t("settings.sections.maintenance.dedup.title", {
                    defaultValue: "Detect duplicate entities / concepts",
                  })}
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Asks the LLM to scan concept pages and group ones that refer to the same topic.
              </p>

              {!projectReady && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Open a project first.
                </p>
              )}
              {projectReady && !llmReady && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Configure an LLM provider first.
                </p>
              )}

              <Button
                onClick={() => void handleScan()}
                disabled={scanning || !projectReady || !llmReady}
              >
                {scanning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Scanning…
                  </>
                ) : (
                  "Scan for duplicates"
                )}
              </Button>

              {scanError && (
                <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>{scanError}</div>
                </div>
              )}

              {scanCompleted && groups.length === 0 && !scanError && (
                <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>No duplicate groups found. The wiki is clean.</div>
                </div>
              )}
            </div>

            <QueueOrphanList
              tasks={tasks}
              groups={groups}
              restoredBacklogWaiting={queueSummary.restoredBacklogWaiting}
              onResumeRestored={handleResumeRestoredQueue}
              onCancel={(id) => void handleCancel(id)}
              onRetry={(id) => void handleRetry(id)}
              pendingPositionByTaskId={pendingPositionByTaskId}
            />

            {groups.map((entry, idx) => {
              const task = findTaskForGroup(tasks, entry.group.slugs)
              const merged = recentlyMergedKeys.has(groupKey(entry.group.slugs))
              return (
                <DuplicateGroupCard
                  key={entry.group.slugs.join(",")}
                  entry={entry}
                  task={task}
                  merged={merged}
                  pendingPosition={
                    task && task.status === "pending"
                      ? pendingPositionByTaskId.get(task.id) ?? 0
                      : 0
                  }
                  onCanonicalChange={(slug) => handleCanonicalChange(idx, slug)}
                  onEnqueue={() => void handleEnqueue(entry)}
                  onCancel={() => task && void handleCancel(task.id)}
                  onRetry={() => task && void handleRetry(task.id)}
                  onNotDuplicate={() => void handleNotDuplicate(idx)}
                />
              )
            })}
          </div>
        )}

        {/* Tab 2: Scheduler & Budget */}
        {activeSubTab === "scheduler" && schedulerConfig && (
          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Autonomous Maintenance Scheduler</h3>
                </div>
                <Button
                  size="sm"
                  variant={isPaused ? "secondary" : "default"}
                  className={isPaused ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                  onClick={handleTogglePause}
                >
                  {isPaused ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                  {isPaused ? "Resume Scheduler" : "Pause Scheduler"}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Accelerated Testing (Time Warp Factor)</Label>
                    <p className="text-[10px] text-muted-foreground">Accelerate cron schedules (e.g. 24.0 makes 1 day take 1 hour)</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    className="h-7 w-20 rounded border bg-background px-2 text-xs"
                    value={schedulerConfig.time_warp_factor}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 1.0
                      setSchedulerConfig((prev) => prev ? { ...prev, time_warp_factor: val } : null)
                    }}
                  />
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs font-semibold">Job Interval Config (Cron Expressions)</Label>
                  <div className="space-y-2">
                    {schedulerConfig.jobs.map((job, idx) => (
                      <div key={job.name} className="flex items-center justify-between gap-2 bg-card p-2 rounded border border-border/40">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={job.enabled}
                            onChange={(e) => {
                              const updated = [...schedulerConfig.jobs]
                              updated[idx] = { ...job, enabled: e.target.checked }
                              setSchedulerConfig((prev) => prev ? { ...prev, jobs: updated } : null)
                            }}
                          />
                          <span className="text-xs font-medium capitalize">{job.name.replace("_", " ")}</span>
                        </div>
                        <input
                          type="text"
                          className="h-7 w-40 rounded border bg-background px-2 text-xs font-mono"
                          value={job.cron}
                          disabled={!job.enabled}
                          onChange={(e) => {
                            const updated = [...schedulerConfig.jobs]
                            updated[idx] = { ...job, cron: e.target.value }
                            setSchedulerConfig((prev) => prev ? { ...prev, jobs: updated } : null)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* API Budget Section */}
                <div className="space-y-3 pt-3 border-t">
                  <div className="flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-amber-500" />
                    <Label className="text-xs font-bold text-foreground">API Consumption & Budget Limits</Label>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-card p-3 rounded border border-border/40">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground block">Monthly Spending Cap (USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        value={schedulerConfig.api_budget?.monthly_cap_usd ?? 10.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0.0
                          const currentBudget = schedulerConfig.api_budget ?? { monthly_cap_usd: 10.0, current_month_spent_usd: 0.0, reset_day: 1 }
                          setSchedulerConfig((prev) => prev ? { ...prev, api_budget: { ...currentBudget, monthly_cap_usd: val } } : null)
                        }}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground block">Monthly Reset Day</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        className="h-8 w-full rounded border bg-background px-2 text-xs"
                        value={schedulerConfig.api_budget?.reset_day ?? 1}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1
                          const currentBudget = schedulerConfig.api_budget ?? { monthly_cap_usd: 10.0, current_month_spent_usd: 0.0, reset_day: 1 }
                          setSchedulerConfig((prev) => prev ? { ...prev, api_budget: { ...currentBudget, reset_day: val } } : null)
                        }}
                      />
                    </div>

                    <div className="col-span-2 space-y-1 pt-1 border-t">
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Spent This Month:</span>
                        <span className="font-semibold text-foreground">
                          ${(schedulerConfig.api_budget?.current_month_spent_usd ?? 0.0).toFixed(3)} / ${(schedulerConfig.api_budget?.monthly_cap_usd ?? 10.0).toFixed(2)} USD
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${Math.min(
                              100,
                              ((schedulerConfig.api_budget?.current_month_spent_usd ?? 0.0) / (schedulerConfig.api_budget?.monthly_cap_usd ?? 10.0)) * 100
                            )}%`
                          }}
                        />
                      </div>
                      <button
                        onClick={() => {
                          const currentBudget = schedulerConfig.api_budget ?? { monthly_cap_usd: 10.0, current_month_spent_usd: 0.0, reset_day: 1 }
                          setSchedulerConfig((prev) => prev ? { ...prev, api_budget: { ...currentBudget, current_month_spent_usd: 0.0 } } : null)
                        }}
                        className="text-[9px] text-primary hover:underline block pt-1"
                      >
                        Reset Spending Counter
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}>
                    {savingConfig ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                    Save Scheduler & Budget Settings
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Judge Ensemble */}
        {activeSubTab === "ensemble" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-4">
              <div className="flex items-center gap-2 border-b pb-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Multi-Voter Judge Ensemble Configurations</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                WikiMind runs a three-judge parallel LLM ensemble to automatically resolve conflicting evidence disputes. Define the configurations for the three judges below.
              </p>

              <div className="space-y-4">
                <JudgeConfigForm
                  label="Judge 1 (Primary)"
                  config={j1}
                  onChange={(cfg) => setJ1(cfg)}
                />
                <JudgeConfigForm
                  label="Judge 2 (Corroborator)"
                  config={j2}
                  onChange={(cfg) => setJ2(cfg)}
                />
                <JudgeConfigForm
                  label="Judge 3 (Skeptic)"
                  config={j3}
                  onChange={(cfg) => setJ3(cfg)}
                />
              </div>

              {schedulerConfig?.ensemble && (
                <div className="pt-3 border-t space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Fallback to Single Judge</Label>
                    <input
                      type="checkbox"
                      checked={schedulerConfig.ensemble.fallback_to_single_judge}
                      onChange={(e) => {
                        const ens = schedulerConfig.ensemble ?? { judges: [], fallback_to_single_judge: true, escalation_threshold: 0.6 }
                        setSchedulerConfig((prev) => prev ? { ...prev, ensemble: { ...ens, fallback_to_single_judge: e.target.checked } } : null)
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">If three judges are not configured or usable, fall back to the main LLM provider.</p>

                  <div className="flex items-center justify-between pt-2">
                    <Label className="text-xs font-semibold">Escalation Agreement Threshold</Label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      max="1.0"
                      className="h-7 w-20 rounded border bg-background px-2 text-xs"
                      value={schedulerConfig.ensemble.escalation_threshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0.6
                        const ens = schedulerConfig.ensemble ?? { judges: [], fallback_to_single_judge: true, escalation_threshold: 0.6 }
                        setSchedulerConfig((prev) => prev ? { ...prev, ensemble: { ...ens, escalation_threshold: val } } : null)
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Minimum agreement confidence ratio (winning weight / total weight) before escalating to manual human review.</p>
                </div>
              )}

              <div className="flex justify-between pt-2">
                {schedulerConfig?.ensemble && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveConfig}
                    disabled={savingConfig}
                  >
                    Save Thresholds
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveJudges} disabled={savingJudges}>
                  {savingJudges ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Save Judge Configurations
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Evaluation Harness */}
        {activeSubTab === "eval" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold">System Evaluation Harness</h3>
                </div>
                <Button size="sm" onClick={handleRunEval} disabled={runningEval}>
                  {runningEval ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Evaluating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                      Run Evaluation Suite
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Runs the system evaluation suite against 20+ ground-truth labeled contradiction test cases. Compares the False Positive Rate (FPR) of the single LLM judge against the 3-judge ensemble.
              </p>

              {/* Latest Run Stats */}
              {evalResults && evalResults.runs && evalResults.runs.length > 0 && (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded text-xs text-emerald-800 dark:text-emerald-300">
                    <span className="font-bold">Latest Result:</span> {evalResults.runs[0].notes}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Single Judge Card */}
                    <div className="border border-border/40 bg-card p-3 rounded space-y-2">
                      <div className="text-xs font-bold text-muted-foreground">Single Judge (Primary)</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>Correct: <span className="font-semibold text-foreground">{evalResults.runs[0].single_judge.correct}</span></div>
                        <div>FPR: <span className="font-semibold text-rose-500">{(evalResults.runs[0].single_judge.fpr * 100).toFixed(1)}%</span></div>
                        <div>False Positives: <span className="font-semibold text-foreground">{evalResults.runs[0].single_judge.false_positive}</span></div>
                        <div>False Negatives: <span className="font-semibold text-foreground">{evalResults.runs[0].single_judge.false_negative}</span></div>
                      </div>
                    </div>

                    {/* Ensemble Card */}
                    <div className="border border-primary/20 bg-primary/5 p-3 rounded space-y-2">
                      <div className="text-xs font-bold text-primary">3-Judge Ensemble</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>Correct: <span className="font-semibold text-foreground">{evalResults.runs[0].ensemble.correct}</span></div>
                        <div>FPR: <span className="font-semibold text-emerald-500">{(evalResults.runs[0].ensemble.fpr * 100).toFixed(1)}%</span></div>
                        <div>False Positives: <span className="font-semibold text-foreground">{evalResults.runs[0].ensemble.false_positive}</span></div>
                        <div>False Negatives: <span className="font-semibold text-foreground">{evalResults.runs[0].ensemble.false_negative}</span></div>
                      </div>
                    </div>
                  </div>

                  {/* History List */}
                  <div className="space-y-2 pt-3 border-t">
                    <div className="flex items-center gap-1.5">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-xs font-bold">Evaluation Run History</Label>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {evalResults.runs.map((run, i) => (
                        <div key={i} className="flex justify-between items-center text-[10px] p-2 bg-card rounded border border-border/40">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{run.notes}</span>
                            <span className="text-muted-foreground">{new Date(run.run_at).toLocaleString()}</span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded font-bold ${
                            run.fpr_reduction_pct > 0 ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"
                          }`}>
                            {run.fpr_reduction_pct > 0 ? `-${run.fpr_reduction_pct.toFixed(1)}% FPR` : "0% reduction"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function JudgeConfigForm({
  label,
  config,
  onChange,
}: {
  label: string
  config: LlmConfig
  onChange: (cfg: LlmConfig) => void
}) {
  const providers = ["openai", "anthropic", "gemini", "ollama", "custom"] as const

  return (
    <div className="space-y-2 rounded border border-border/40 bg-card p-3">
      <h4 className="text-xs font-bold text-foreground">{label}</h4>
      <div className="grid grid-cols-3 gap-2">
        {/* Provider */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Provider</label>
          <select
            className="h-8 w-full rounded border bg-background px-2 text-xs"
            value={config.provider}
            onChange={(e) => onChange({ ...config, provider: e.target.value as any })}
          >
            {providers.map((p) => (
              <option key={p} value={p}>{p.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Model</label>
          <input
            type="text"
            className="h-8 w-full rounded border bg-background px-2 text-xs"
            value={config.model}
            placeholder="e.g. gpt-4o"
            onChange={(e) => onChange({ ...config, model: e.target.value })}
          />
        </div>

        {/* API Key */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">API Key</label>
          <input
            type="password"
            className="h-8 w-full rounded border bg-background px-2 text-xs font-mono"
            value={config.apiKey}
            placeholder="••••••••"
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

/** A useRef variant that initializes lazily — avoids constructing a new
 *  Set on every render. Kept inline since it's only used here. */
function useRefInit<T>(init: () => T): { current: T } {
  const [ref] = useState<{ current: T }>(() => ({ current: init() }))
  return ref
}

interface QueueOrphanListProps {
  tasks: readonly DedupTask[]
  groups: GroupUiEntry[]
  restoredBacklogWaiting: boolean
  onResumeRestored: () => void
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  pendingPositionByTaskId: Map<string, number>
}

/**
 * Render queued tasks that don't have a matching card on screen.
 */
function QueueOrphanList({
  tasks,
  groups,
  restoredBacklogWaiting,
  onResumeRestored,
  onCancel,
  onRetry,
  pendingPositionByTaskId,
}: QueueOrphanListProps) {
  const { t } = useTranslation()
  const groupKeys = new Set(groups.map((g) => groupKey(g.group.slugs)))
  const orphans = tasks.filter((t) => !groupKeys.has(groupKey(t.group.slugs)))

  if (orphans.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.dedup.queueTitle", {
            defaultValue: "In-progress merges",
          })}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Tasks queued from a previous scan that haven't finished yet. Merges run one at a time.
      </p>
      {restoredBacklogWaiting && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <span className="text-amber-800 dark:text-amber-300">
            These merge tasks were restored from the previous session and are paused to avoid unexpected LLM usage.
          </span>
          <Button size="sm" variant="secondary" onClick={onResumeRestored}>
            <RotateCcw className="h-3.5 w-3.5" />
            Resume merges
          </Button>
        </div>
      )}
      {orphans.map((task) => (
        <div
          key={task.id}
          className="flex flex-wrap items-center gap-2 rounded border border-border/40 bg-background px-3 py-2 text-xs"
        >
          <code className="font-mono">{task.group.slugs.join(" + ")}</code>
          <span className="text-muted-foreground">
            → <code className="font-mono">{task.canonicalSlug}</code>
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <TaskStatusChip
              task={task}
              pendingPosition={pendingPositionByTaskId.get(task.id) ?? 0}
            />
            {task.status === "failed" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(task.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onCancel(task.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </span>
          {task.error && task.status === "failed" && (
            <div className="basis-full rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1 text-rose-700 dark:text-rose-400">
              {task.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface ChipProps {
  task: DedupTask
  pendingPosition: number
}

function TaskStatusChip({ task, pendingPosition }: ChipProps) {
  const { t } = useTranslation()
  if (task.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Merging…
      </span>
    )
  }
  if (task.status === "pending") {
    if (pendingPosition === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          Queued
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
        {t("settings.sections.maintenance.dedup.queuedAhead", { defaultValue: "Queued ({{n}} ahead)", n: pendingPosition })}
      </span>
    )
  }
  if (task.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400">
        <AlertTriangle className="h-3 w-3" />
        {t("settings.sections.maintenance.dedup.failedRetries", { defaultValue: "Failed ({{retries}}/3)", retries: task.retryCount })}
      </span>
    )
  }
  return null
}

interface CardProps {
  entry: GroupUiEntry
  task: DedupTask | undefined
  merged: boolean
  pendingPosition: number
  onCanonicalChange: (slug: string) => void
  onEnqueue: () => void
  onCancel: () => void
  onRetry: () => void
  onNotDuplicate: () => void
}

function DuplicateGroupCard({
  entry,
  task,
  merged,
  pendingPosition,
  onCanonicalChange,
  onEnqueue,
  onCancel,
  onRetry,
  onNotDuplicate,
}: CardProps) {
  const { t } = useTranslation()
  const { group, canonicalSlug, skipped } = entry

  const inFlight = !!task && (task.status === "pending" || task.status === "processing")
  const failed = !!task && task.status === "failed"
  const finished = merged || skipped

  const confidenceClass =
    group.confidence === "high"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : group.confidence === "medium"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground"

  return (
    <div
      className={`space-y-3 rounded-lg border px-4 py-3 ${
        finished ? "border-border/40 bg-muted/10 opacity-60" : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${confidenceClass}`}>
          {group.confidence}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("settings.sections.maintenance.dedup.candidates", { defaultValue: "{{n}} candidates", n: group.slugs.length })}
        </span>
        {merged && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Merged
          </span>
        )}
        {skipped && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            Marked not duplicates
          </span>
        )}
        {task && !finished && (
          <span className="ml-auto">
            <TaskStatusChip task={task} pendingPosition={pendingPosition} />
          </span>
        )}
      </div>

      {group.reason && (
        <div className="text-xs italic leading-relaxed text-muted-foreground">{group.reason}</div>
      )}

      {!finished && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Keep this slug as canonical:
            </Label>
            {group.slugs.map((slug) => (
              <label
                key={slug}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name={`canonical-${group.slugs.join(",")}`}
                  checked={canonicalSlug === slug}
                  onChange={() => onCanonicalChange(slug)}
                  disabled={inFlight}
                />
                <code className="font-mono text-xs">{slug}</code>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {!task && (
              <>
                <Button size="sm" onClick={onEnqueue}>
                  Merge into {canonicalSlug}
                </Button>
                <Button size="sm" variant="ghost" onClick={onNotDuplicate}>
                  Not duplicates
                </Button>
              </>
            )}
            {inFlight && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                <Trash2 className="h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
            {failed && (
              <>
                <Button size="sm" onClick={onRetry}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {failed && task?.error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{task.error}</div>
        </div>
      )}
    </div>
  )
}
