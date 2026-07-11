import { useEffect, useState, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { 
  PlusCircle, 
  CheckCircle2, 
  AlertTriangle, 
  Edit, 
  Info, 
  ChevronDown, 
  ChevronUp, 
  Filter, 
  Calendar, 
  ArrowRight,
  Loader2
} from "lucide-react"

interface TimelineEvent {
  id: string
  date: string
  timestamp?: number
  type: "ingest" | "re_verify" | "contradiction" | "rewrite" | "general"
  title: string
  details?: string[]
}

export function ActivityTimeline() {
  const project = useWikiStore((s) => s.project)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [activeFilter, setActiveFilter] = useState<"all" | "ingest" | "re_verify" | "contradiction" | "rewrite">("all")
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!project) return

    const loadTimeline = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Fetch job logs from jobs.jsonl via tauri command
        let jobLogs: any[] = []
        try {
          jobLogs = await invoke<any[]>("maintenance_job_history", {
            projectPath: project.path
          })
        } catch (e) {
          console.warn("Failed to load jobs.jsonl history:", e)
        }

        // 2. Read wiki/log.md file content
        let logMdContent = ""
        try {
          logMdContent = await readFile(`${project.path}/wiki/log.md`)
        } catch (e) {
          console.warn("wiki/log.md not found, using empty string")
        }

        // 3. Parse wiki/log.md events
        const logEvents: TimelineEvent[] = []
        if (logMdContent) {
          const lines = logMdContent.split("\n")
          let currentHeaderDate = ""

          for (let line of lines) {
            line = line.trim()
            if (!line) continue

            // Match ## YYYY-MM-DD or ## [YYYY-MM-DD]
            const headerMatch = line.match(/^##\s+\[?(\d{4}-\d{2}-\d{2})\]?/)
            if (headerMatch) {
              currentHeaderDate = headerMatch[1]
              continue
            }

            // Match bullet points
            if (line.startsWith("- ") || line.startsWith("* ")) {
              const text = line.substring(2).trim()
              if (!text) continue

              // Attempt to match an inline date override, else use header date
              const inlineDateMatch = text.match(/\[?(\d{4}-\d{2}-\d{2})\]?/)
              const eventDate = inlineDateMatch ? inlineDateMatch[1] : currentHeaderDate

              if (!eventDate) continue

              // Classify type based on keywords
              let type: TimelineEvent["type"] = "general"
              const lower = text.toLowerCase()
              if (lower.includes("ingest") || lower.includes("saved page") || lower.includes("created concept") || lower.includes("created entity")) {
                type = "ingest"
              } else if (lower.includes("verify") || lower.includes("audit") || lower.includes("decay")) {
                type = "re_verify"
              } else if (lower.includes("contradiction") || lower.includes("dispute") || lower.includes("resolved contradiction") || lower.includes("ensemble")) {
                type = "contradiction"
              } else if (lower.includes("rewrite") || lower.includes("updated page") || lower.includes("modified") || lower.includes("changed")) {
                type = "rewrite"
              }

              logEvents.push({
                id: `log-${eventDate}-${Math.random().toString(36).substr(2, 9)}`,
                date: eventDate,
                type,
                title: text,
                details: []
              })
            }
          }
        }

        // 4. Map and format job history events
        const jobEvents: TimelineEvent[] = jobLogs.map((job) => {
          const dateStr = job.start_time ? job.start_time.split("T")[0] : ""
          let type: TimelineEvent["type"] = "general"
          
          if (job.type === "decay_scan" || job.type === "re_verification") {
            type = "re_verify"
          } else if (job.type === "contradiction_resolution") {
            type = "contradiction"
          }

          const title = `Scheduled Maintenance: ${job.type.replace("_", " ").toUpperCase()}`
          const details: string[] = [
            `Started at: ${new Date(job.start_time).toLocaleTimeString()}`,
            `Ended at: ${new Date(job.end_time).toLocaleTimeString()}`,
            `Claims Scanned: ${job.claims_scanned}`,
            ...(job.actions_taken || []),
            ...(job.errors || []).map((err: string) => `Error: ${err}`)
          ]

          return {
            id: `job-${job.job_id || Math.random()}`,
            date: dateStr,
            timestamp: new Date(job.start_time).getTime(),
            type,
            title,
            details
          }
        })

        // 5. Combine and Sort events chronologically
        const combined = [...logEvents, ...jobEvents].sort((a, b) => {
          // If timestamps are available, compare them, otherwise compare dates
          if (a.timestamp && b.timestamp) {
            return b.timestamp - a.timestamp
          }
          // Secondary fallback to date string comparison
          return b.date.localeCompare(a.date)
        })

        setEvents(combined)
      } catch (err) {
        console.error("Failed to construct activity timeline:", err)
        setError("Failed to construct system activity timeline.")
      } finally {
        setLoading(false)
      }
    }

    loadTimeline()
  }, [project])

  const toggleExpand = (id: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Filter events list
  const filteredEvents = useMemo(() => {
    if (activeFilter === "all") return events
    return events.filter(e => e.type === activeFilter)
  }, [events, activeFilter])

  // Custom Event Visuals mapping
  const getEventConfig = (type: TimelineEvent["type"]) => {
    const config = {
      ingest: {
        icon: PlusCircle,
        bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
        border: "border-emerald-500/30",
        iconColor: "text-emerald-500"
      },
      re_verify: {
        icon: CheckCircle2,
        bg: "bg-sky-500/10 dark:bg-sky-500/20",
        border: "border-sky-500/30",
        iconColor: "text-sky-500"
      },
      contradiction: {
        icon: AlertTriangle,
        bg: "bg-amber-500/10 dark:bg-amber-500/20",
        border: "border-amber-500/30",
        iconColor: "text-amber-500"
      },
      rewrite: {
        icon: Edit,
        bg: "bg-purple-500/10 dark:bg-purple-500/20",
        border: "border-purple-500/30",
        iconColor: "text-purple-500"
      },
      general: {
        icon: Info,
        bg: "bg-muted/40",
        border: "border-border/60",
        iconColor: "text-muted-foreground"
      }
    }
    return config[type] || config.general
  }

  // Helper to parse [[page-slug]] in text and turn them into clickable tags
  const renderTitleText = (title: string) => {
    const parts = title.split(/(\[\[.*?\]\])/g)
    
    return parts.map((part, idx) => {
      if (part.startsWith("[[") && part.endsWith("]]")) {
        const slug = part.slice(2, -2)
        return (
          <button
            key={idx}
            onClick={() => {
              if (!project) return
              let relativePath = slug
              if (!slug.includes("/")) {
                // Default to concepts
                relativePath = `wiki/concepts/${slug}.md`
              }
              const absPath = `${project.path}/${relativePath}`
              useWikiStore.getState().openPathInPreview(absPath)
              useWikiStore.getState().setActiveView("wiki")
            }}
            className="text-primary hover:underline font-mono bg-primary/5 px-1 py-0.5 rounded cursor-pointer mx-0.5 inline-block text-[11px]"
          >
            {slug.split("/").pop()?.replace(".md", "")}
          </button>
        )
      }
      return <span key={idx}>{part}</span>
    })
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">Constructing timeline...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-destructive">
        <p className="text-sm font-semibold">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      
      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-4 border-border/50">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
          <Filter className="h-3.5 w-3.5" /> Filter by type:
        </div>
        <button
          onClick={() => setActiveFilter("all")}
          className={`px-3 py-1 text-xs rounded-full border transition-all ${
            activeFilter === "all"
              ? "bg-foreground text-background border-foreground font-semibold"
              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          All Activities
        </button>
        <button
          onClick={() => setActiveFilter("ingest")}
          className={`px-3 py-1 text-xs rounded-full border transition-all ${
            activeFilter === "ingest"
              ? "bg-emerald-500 text-white border-emerald-500 font-semibold shadow-sm"
              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          Ingests
        </button>
        <button
          onClick={() => setActiveFilter("re_verify")}
          className={`px-3 py-1 text-xs rounded-full border transition-all ${
            activeFilter === "re_verify"
              ? "bg-sky-500 text-white border-sky-500 font-semibold shadow-sm"
              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          Audit Runs
        </button>
        <button
          onClick={() => setActiveFilter("contradiction")}
          className={`px-3 py-1 text-xs rounded-full border transition-all ${
            activeFilter === "contradiction"
              ? "bg-amber-500 text-white border-amber-500 font-semibold shadow-sm"
              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          Disputes
        </button>
        <button
          onClick={() => setActiveFilter("rewrite")}
          className={`px-3 py-1 text-xs rounded-full border transition-all ${
            activeFilter === "rewrite"
              ? "bg-purple-500 text-white border-purple-500 font-semibold shadow-sm"
              : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          Rewrites
        </button>
      </div>

      {/* Timeline List */}
      <div className="relative pl-6 border-l border-border/60 space-y-6 ml-3">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border/40 rounded-xl bg-muted/5 text-muted-foreground text-xs">
            No activities recorded in this category.
          </div>
        ) : (
          filteredEvents.map((event) => {
            const visual = getEventConfig(event.type)
            const Icon = visual.icon
            const isExpanded = expandedEvents.has(event.id)
            const hasDetails = event.details && event.details.length > 0

            return (
              <div key={event.id} className="relative group">
                
                {/* Visual Icon Node on line */}
                <div className={`absolute -left-[35px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm ${visual.border} ${visual.iconColor} z-10 transition-transform group-hover:scale-110`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>

                {/* Main Card */}
                <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm space-y-2 hover:border-border transition-colors">
                  
                  {/* Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                    
                    {/* Event Title */}
                    <div className="font-semibold text-foreground/90 leading-relaxed max-w-xl">
                      {renderTitleText(event.title)}
                    </div>
                    
                    {/* Event Date badge */}
                    <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground/80 shrink-0">
                      <Calendar className="h-3 w-3" />
                      <span>{event.date}</span>
                    </div>

                  </div>

                  {/* Expandable Details Box */}
                  {hasDetails && (
                    <div className="pt-1">
                      <button
                        onClick={() => toggleExpand(event.id)}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" /> Hide diagnostic details
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" /> View diagnostic details ({event.details?.length} lines)
                          </>
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 bg-muted/40 rounded border border-border/40 p-3 text-[11px] font-mono space-y-1 text-muted-foreground overflow-x-auto">
                          {event.details?.map((detail, dIdx) => (
                            <div key={dIdx} className="flex items-start gap-1">
                              <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" />
                              <span className="leading-relaxed">{detail}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                </div>

              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
