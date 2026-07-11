import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { ClipboardList, Play, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Activity } from "lucide-react"

interface JobLogEntry {
  job_id: string
  type: string // "decay_scan" | "re_verification" | "contradiction_resolution" | "health_report"
  start_time: string
  end_time: string
  claims_scanned: number
  actions_taken: string[]
  errors: string[]
}

export function JobHistory() {
  const project = useWikiStore((s) => s.project)
  const [jobs, setJobs] = useState<JobLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return

    const fetchJobs = async () => {
      try {
        setLoading(true)
        const res = await invoke<JobLogEntry[]>("maintenance_job_history", {
          projectPath: project.path,
        })
        setJobs(res)
        setError(null)
      } catch (err) {
        console.error("Failed to load job history:", err)
        setError("Failed to load audit history")
      } finally {
        setLoading(false)
      }
    }

    fetchJobs()
  }, [project])

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  const getJobIcon = (type: string) => {
    switch (type) {
      case "decay_scan":
        return <Activity className="h-5 w-5 text-indigo-500" />
      case "re_verification":
        return <Play className="h-5 w-5 text-emerald-500" />
      default:
        return <ClipboardList className="h-5 w-5 text-muted-foreground" />
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-muted-foreground animate-pulse">Loading audit history...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-destructive">
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <h3 className="font-semibold text-foreground">No Maintenance Run Logs</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Logs will appear here once scheduler starts running jobs.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isExpanded = expandedId === job.job_id
            const hasErrors = job.errors && job.errors.length > 0
            
            return (
              <div
                key={job.job_id}
                className="rounded-xl border border-border/50 bg-card hover:border-border transition-colors overflow-hidden"
              >
                <div
                  onClick={() => toggleExpand(job.job_id)}
                  className="flex cursor-pointer items-center justify-between p-4"
                >
                  <div className="flex items-center gap-3">
                    {getJobIcon(job.type)}
                    <div>
                      <h4 className="font-semibold text-foreground capitalize">
                        {job.type.replace("_", " ")}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Ran at: {job.start_time} (Duration: {new Date(job.end_time).getTime() - new Date(job.start_time).getTime()}ms)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right text-xs mr-2">
                      <span className="text-muted-foreground block">Scanned</span>
                      <span className="font-semibold text-foreground">{job.claims_scanned} claims</span>
                    </div>

                    {hasErrors ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                        <AlertCircle className="h-3 w-3" /> Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                        <CheckCircle2 className="h-3 w-3" /> Success
                      </span>
                    )}

                    {isExpanded ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/50 bg-muted/10 p-5 space-y-4">
                    {/* Actions Taken */}
                    {job.actions_taken && job.actions_taken.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Actions Log</span>
                        <ul className="list-disc pl-4 text-xs text-foreground/80 space-y-1">
                          {job.actions_taken.map((action, aIdx) => (
                            <li key={aIdx}>{action}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Errors */}
                    {hasErrors && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-destructive block">Errors Encountered</span>
                        <ul className="list-disc pl-4 text-xs text-destructive/90 space-y-1">
                          {job.errors.map((err, eIdx) => (
                            <li key={eIdx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Technical details JSON */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Raw Payload</span>
                      <pre className="text-[10px] bg-card p-3 rounded-lg border border-border/40 text-muted-foreground overflow-x-auto max-h-40">
                        {JSON.stringify(job, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
