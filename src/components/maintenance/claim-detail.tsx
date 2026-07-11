import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { ArrowLeft, FileText, Globe, Link2, ExternalLink } from "lucide-react"
import { DecayChart } from "./decay-chart"

interface ClaimSource {
  path: string
  page: number | null
  excerpt: string
  verified_at: string
  url: string | null
}

interface ClaimHistoryEntry {
  date: string
  confidence: number
  event: string
  source: string
  note: string | null
}

interface Claim {
  title: string
  confidence: number
  source_count: number
  last_verified: string
  verification_count: number
  contradiction_count: number
  freshness_state: "fresh" | "aging" | "stale" | "decayed"
  date: string
  tags: string[]
  domain_volatility: "low" | "medium" | "high" | null
  description: string | null
  sources: ClaimSource[]
  parent_concepts: string[]
  contradictions: string[]
  history: ClaimHistoryEntry[]
  content: string
}

interface ClaimDetailProps {
  filename: string
  onBack: () => void
}

export function ClaimDetail({ filename, onBack }: ClaimDetailProps) {
  const project = useWikiStore((s) => s.project)
  const [claim, setClaim] = useState<Claim | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return

    const fetchClaim = async () => {
      try {
        setLoading(true)
        const res = await invoke<Claim>("maintenance_get_claim", {
          projectPath: project.path,
          filename,
        })
        setClaim(res)
        setError(null)
      } catch (err) {
        console.error("Failed to load claim detail:", err)
        setError("Failed to load claim details")
      } finally {
        setLoading(false)
      }
    }

    fetchClaim()
  }, [project, filename])

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <span className="text-muted-foreground animate-pulse">Loading claim details...</span>
      </div>
    )
  }

  if (error || !claim) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-destructive">
        <p>{error || "No data available"}</p>
        <button onClick={onBack} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold hover:underline">
          <ArrowLeft className="h-4 w-4" /> Go back
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Claims
        </button>
        <div className="flex items-center gap-2">
          {claim.domain_volatility && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground capitalize">
              Volatility: {claim.domain_volatility}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize border ${
            claim.freshness_state === "fresh" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
            claim.freshness_state === "aging" ? "bg-amber-400/10 text-amber-500 border-amber-400/20" :
            claim.freshness_state === "stale" ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
            "bg-destructive/10 text-destructive border-destructive/20"
          }`}>
            {claim.freshness_state}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Claim Detail */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{claim.title}</h1>
            {claim.description && (
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{claim.description}</p>
            )}
          </div>

          {/* Decay Graph */}
          <DecayChart claim={claim} />

          {/* Prose Content */}
          {claim.content && (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Claim Details & Analysis</h4>
              <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {claim.content}
              </div>
            </div>
          )}

          {/* Provenance / Sources */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Provenance & Evidence</h3>
            {claim.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No source documents attached.</p>
            ) : (
              <div className="grid gap-4">
                {claim.sources.map((src, idx) => (
                  <div key={idx} className="rounded-xl border border-border/50 bg-card p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {src.path.split("/").pop()}
                      </div>
                      <span className="text-muted-foreground">Verified: {src.verified_at}</span>
                    </div>
                    {src.excerpt && (
                      <p className="text-xs bg-muted/50 p-2.5 rounded border border-border/30 italic text-muted-foreground">
                        "{src.excerpt}"
                      </p>
                    )}
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1">
                      <span>Page: {src.page || "N/A"}</span>
                      {src.url && (
                        <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-primary transition-colors">
                          <Globe className="h-3 w-3" /> Original Source <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* Metadata Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground border-b pb-2">Audit Diagnostic</h3>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block mb-0.5">Confidence Level</span>
                <span className="text-base font-bold text-foreground">{Math.round(claim.confidence * 100)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">Total Sources</span>
                <span className="text-base font-bold text-foreground">{claim.source_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">Last Audited</span>
                <span className="text-base font-bold text-foreground">{claim.last_verified}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">Disputes</span>
                <span className={`text-base font-bold ${claim.contradiction_count > 0 ? "text-destructive" : "text-foreground"}`}>
                  {claim.contradiction_count}
                </span>
              </div>
            </div>

            {claim.tags.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <span className="text-muted-foreground text-xs block">Topic Tags</span>
                <div className="flex flex-wrap gap-1">
                  {claim.tags.map((tag) => (
                    <span key={tag} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {claim.parent_concepts.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t">
                <span className="text-muted-foreground text-xs block">Linked Concepts</span>
                <div className="space-y-1">
                  {claim.parent_concepts.map((concept) => (
                    <div key={concept} className="flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors cursor-pointer">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{concept.split("/").pop()?.replace(".md", "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* History Timeline */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground border-b pb-2">History & Verification Logs</h3>
            <div className="relative pl-4 space-y-4 border-l border-border/60">
              {claim.history.map((hist, idx) => (
                <div key={idx} className="relative space-y-1 text-xs">
                  {/* Timeline Dot */}
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
                  
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-foreground capitalize">{hist.event.replace("_", " ")}</span>
                    <span className="text-muted-foreground text-[10px]">{hist.date}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Source: {hist.source}</p>
                  {hist.note && (
                    <p className="text-[11px] text-foreground/80 bg-muted/30 p-1.5 rounded">{hist.note}</p>
                  )}
                  <div className="text-[10px] text-primary font-semibold">
                    Confidence set to {Math.round(hist.confidence * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
