import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { AlertCircle, CheckCircle, Scale, Users, FileText, ChevronRight, ChevronDown, Check, X } from "lucide-react"

interface ContradictionClaimRef {
  path: string
  position: string
}

interface JudgeVote {
  judge_id: string
  model: string
  verdict: string
  reasoning: string
  confidence: number
  voted_at: string
}

interface Contradiction {
  title: string
  status: "open" | "under_review" | "resolved" | "escalated"
  date: string
  tags: string[]
  claims: ContradictionClaimRef[]
  judge_votes: JudgeVote[]
  resolution_method: string | null
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  description: string | null
  new_evidence: string | null
}

export function ContradictionsPanel() {
  const project = useWikiStore((s) => s.project)
  const [contradictions, setContradictions] = useState<Contradiction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Selection/resolution state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [resolvingIdx, setResolvingIdx] = useState<number | null>(null)
  const [resolutionText, setResolutionText] = useState("")
  const [resolutionMethod, setResolutionMethod] = useState("human")

  const fetchContradictions = async () => {
    if (!project) return
    try {
      setLoading(true)
      const res = await invoke<Contradiction[]>("maintenance_list_contradictions", {
        projectPath: project.path,
      })
      setContradictions(res)
      setError(null)
    } catch (err) {
      console.error("Failed to load contradictions:", err)
      setError("Failed to load contradictions")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContradictions()
  }, [project])

  const handleResolve = async (idx: number) => {
    if (!project) return
    const contradiction = contradictions[idx]
    const filename = `${contradiction.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.md`
    try {
      await invoke("maintenance_resolve_contradiction", {
        projectPath: project.path,
        filename,
        resolution: resolutionText,
        method: resolutionMethod,
      })
      setResolvingIdx(null)
      setResolutionText("")
      await fetchContradictions()
    } catch (err) {
      console.error("Failed to resolve contradiction:", err)
      alert("Failed to save resolution")
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-muted-foreground animate-pulse">Loading disputes...</span>
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
    <div className="space-y-6">
      {contradictions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
          <Scale className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <h3 className="font-semibold text-foreground">No Disagreements</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            All ingested claims are currently aligned.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {contradictions.map((c, idx) => {
            const isSelected = selectedIdx === idx
            const isResolving = resolvingIdx === idx
            return (
              <div
                key={idx}
                className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                  isSelected ? "border-primary bg-card/60" : "border-border/50 bg-card hover:border-border"
                }`}
              >
                {/* Header Row */}
                <div
                  onClick={() => setSelectedIdx(isSelected ? null : idx)}
                  className="flex cursor-pointer items-center justify-between p-4"
                >
                  <div className="flex items-center gap-3">
                    {c.status === "resolved" ? (
                      <CheckCircle className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive animate-pulse" />
                    )}
                    <div>
                      <h4 className="font-semibold text-foreground leading-snug">{c.title}</h4>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>Detected: {c.date}</span>
                        {c.tags.map((tag) => (
                          <span key={tag} className="rounded bg-accent/60 px-1 text-[10px] font-medium text-accent-foreground">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                      c.status === "resolved" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                      c.status === "under_review" ? "bg-amber-400/10 text-amber-500 border-amber-400/20" :
                      "bg-destructive/10 text-destructive border-destructive/20"
                    }`}>
                      {c.status}
                    </span>
                    {isSelected ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                  </div>
                </div>

                {/* Details Accordion Content */}
                {isSelected && (
                  <div className="border-t border-border/50 bg-muted/10 p-6 space-y-6">
                    {c.description && (
                      <p className="text-sm text-foreground/80 leading-relaxed bg-card p-3 rounded-lg border border-border/40">
                        {c.description}
                      </p>
                    )}

                    {/* Claims Comparison */}
                    <div className="grid gap-6 md:grid-cols-2">
                      {c.claims.map((claim, cIdx) => (
                        <div key={cIdx} className="rounded-xl border border-border/50 bg-card p-5 space-y-3 relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                            <span>CLAIM {cIdx === 0 ? "A" : "B"}</span>
                          </div>
                          <div className="font-semibold text-foreground text-sm">{claim.position}</div>
                          <div className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                            <FileText className="h-3.5 w-3.5" />
                            <span>{claim.path.split("/").pop()}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Votes panel if ensemble has run */}
                    {c.judge_votes.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Users className="h-4 w-4" /> Judge Ensemble Votes
                        </h5>
                        <div className="grid gap-4 sm:grid-cols-3">
                          {c.judge_votes.map((vote, vIdx) => (
                            <div key={vIdx} className="rounded-xl border border-border/50 bg-card p-4 space-y-2 text-xs">
                              <div className="flex items-center justify-between font-semibold border-b pb-1.5">
                                <span className="text-foreground">{vote.judge_id}</span>
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground capitalize">
                                  {vote.verdict.replace("_", " ")}
                                </span>
                              </div>
                              <p className="text-muted-foreground italic">"{vote.reasoning}"</p>
                              <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1.5">
                                <span>Model: {vote.model}</span>
                                <span>Conf: {Math.round(vote.confidence * 100)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resolution status */}
                    {c.status === "resolved" ? (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
                        <div className="text-xs font-semibold text-emerald-500 flex items-center gap-1">
                          <Check className="h-4 w-4" /> Dispute Resolved
                        </div>
                        <p className="text-sm font-medium text-foreground">{c.resolution}</p>
                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
                          <span>Method: {c.resolution_method}</span>
                          <span>Resolved at: {c.resolved_at}</span>
                          <span>By: {c.resolved_by}</span>
                        </div>
                      </div>
                    ) : isResolving ? (
                      <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
                        <div className="flex items-center justify-between border-b pb-2">
                          <h5 className="text-xs font-semibold uppercase tracking-wider text-foreground">Resolve Dispute</h5>
                          <button onClick={() => setResolvingIdx(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        
                        <div className="space-y-3">
                          <label className="text-xs font-medium text-muted-foreground block">Resolution Summary / Verdict</label>
                          <textarea
                            value={resolutionText}
                            onChange={(e) => setResolutionText(e.target.value)}
                            placeholder="State the resolution and what modifications were applied to the wiki..."
                            className="w-full rounded-md border border-input bg-background p-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <label className="text-xs font-medium text-muted-foreground block mb-1">Resolution Method</label>
                            <select
                              value={resolutionMethod}
                              onChange={(e) => setResolutionMethod(e.target.value)}
                              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                            >
                              <option value="human">Human Override</option>
                              <option value="single_judge">Single Judge LLM</option>
                              <option value="ensemble_majority">Ensemble Majority</option>
                              <option value="auto_merge">Auto Merge</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => setResolvingIdx(null)}
                            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleResolve(idx)}
                            disabled={!resolutionText.trim()}
                            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                          >
                            Save Resolution
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end pt-2">
                        <button
                          onClick={() => setResolvingIdx(idx)}
                          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
                        >
                          Resolve Dispute
                        </button>
                      </div>
                    )}
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
