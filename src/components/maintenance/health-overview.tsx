import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { Shield, AlertTriangle, AlertCircle, Activity, Clock, Calendar, Cpu } from "lucide-react"

interface DecayStatus {
  total: number
  fresh: number
  aging: number
  stale: number
  decayed: number
}

interface JobLogEntry {
  job_id: string
  type: string
  start_time: string
  end_time: string
  claims_scanned: number
  actions_taken: string[]
  errors: string[]
}

interface SchedulerStatus {
  paused: boolean
  project_path: string
  time_warp_factor: number
  jobs: Array<{ name: string; cron: string; enabled: boolean }>
}

export function HealthOverview() {
  const project = useWikiStore((s) => s.project)
  const [status, setStatus] = useState<DecayStatus | null>(null)
  const [history, setHistory] = useState<JobLogEntry[]>([])
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return

    const fetchStatus = async () => {
      try {
        setLoading(true)
        const [decayRes, historyRes, schedulerRes] = await Promise.all([
          invoke<DecayStatus>("maintenance_decay_status", {
            projectPath: project.path,
          }),
          invoke<JobLogEntry[]>("maintenance_job_history", {
            projectPath: project.path,
          }).catch(() => []),
          invoke<SchedulerStatus>("maintenance_scheduler_status").catch(() => null),
        ])
        setStatus(decayRes)
        setHistory(historyRes)
        setScheduler(schedulerRes)
        setError(null)
      } catch (err) {
        console.error("Failed to load decay status:", err)
        setError("Failed to load diagnostic status")
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()
  }, [project])

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <Activity className="h-6 w-6 animate-pulse text-muted-foreground" />
      </div>
    )
  }

  if (error || !status) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-destructive">
        <AlertTriangle className="mr-2 h-5 w-5" />
        <span>{error || "No data available"}</span>
      </div>
    )
  }

  const { total, fresh, aging, stale, decayed } = status

  // Donut chart calculations
  const radius = 50
  const circumference = 2 * Math.PI * radius
  
  const freshPct = total > 0 ? fresh / total : 0
  const agingPct = total > 0 ? aging / total : 0
  const stalePct = total > 0 ? stale / total : 0
  const decayedPct = total > 0 ? decayed / total : 0

  const freshStroke = circumference * freshPct
  const agingStroke = circumference * agingPct
  const staleStroke = circumference * stalePct
  const decayedStroke = circumference * decayedPct

  const freshOffset = circumference
  const agingOffset = freshOffset - freshStroke
  const staleOffset = agingOffset - agingStroke
  const decayedOffset = staleOffset - staleStroke

  // Calculate days running
  let daysRunning = 0
  if (history.length > 0) {
    const firstTimestamp = new Date(history[history.length - 1].start_time).getTime()
    const lastTimestamp = new Date(history[0].start_time).getTime()
    const diffMs = Math.abs(lastTimestamp - firstTimestamp)
    daysRunning = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (daysRunning === 0) daysRunning = 1
  }
  const daysRunningStr = daysRunning > 60 ? "60+ days" : `${daysRunning} day${daysRunning === 1 ? "" : "s"}`

  // Next scheduled job
  let nextJob = "None"
  if (scheduler && !scheduler.paused) {
    const enabledJobs = scheduler.jobs.filter((j) => j.enabled)
    if (enabledJobs.length > 0) {
      nextJob = enabledJobs[0].name.replace("_", " ")
    }
  } else if (scheduler && scheduler.paused) {
    nextJob = "Paused"
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Donut Chart Card */}
      <div className="flex items-center gap-6 rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="relative h-28 w-28 shrink-0">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r={radius}
              className="fill-none stroke-muted/20"
              strokeWidth="10"
            />
            {freshStroke > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                className="fill-none stroke-emerald-500 transition-all duration-500 ease-out"
                strokeWidth="10"
                strokeDasharray={`${freshStroke} ${circumference}`}
                strokeDashoffset={freshOffset}
                strokeLinecap="round"
              />
            )}
            {agingStroke > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                className="fill-none stroke-amber-400 transition-all duration-500 ease-out"
                strokeWidth="10"
                strokeDasharray={`${agingStroke} ${circumference}`}
                strokeDashoffset={agingOffset}
                strokeLinecap="round"
              />
            )}
            {staleStroke > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                className="fill-none stroke-orange-500 transition-all duration-500 ease-out"
                strokeWidth="10"
                strokeDasharray={`${staleStroke} ${circumference}`}
                strokeDashoffset={staleOffset}
                strokeLinecap="round"
              />
            )}
            {decayedStroke > 0 && (
              <circle
                cx="60"
                cy="60"
                r={radius}
                className="fill-none stroke-destructive transition-all duration-500 ease-out"
                strokeWidth="10"
                strokeDasharray={`${decayedStroke} ${circumference}`}
                strokeDashoffset={decayedOffset}
                strokeLinecap="round"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-bold tracking-tight">{total}</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Claims</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <h3 className="font-semibold tracking-tight text-foreground">Vault Freshness</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Fresh:</span>
              <span className="font-semibold">{fresh}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-muted-foreground">Aging:</span>
              <span className="font-semibold">{aging}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="text-muted-foreground">Stale:</span>
              <span className="font-semibold">{stale}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-muted-foreground">Decayed:</span>
              <span className="font-semibold">{decayed}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Health Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:col-span-2">
        <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Health Score</span>
            <Shield className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight">
              {total > 0 ? Math.round(((fresh * 1.0 + aging * 0.7 + stale * 0.3) / total) * 100) : 100}%
            </span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Weighted decay confidence average
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Urgent Audits</span>
            <AlertCircle className="h-4 w-4 text-orange-500 animate-pulse" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight">{stale + decayed}</span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Claims requiring active re-verification
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Days Running</span>
            <Calendar className="h-4 w-4 text-sky-500" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight">{daysRunningStr}</span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Calculated from audit log activity history
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Jobs Completed</span>
            <Cpu className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight">{history.length}</span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Total maintenance runs completed
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Next Scan</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight truncate capitalize block">{nextJob}</span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Next scheduled audit scan task
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
