import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { Search, SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react"

interface Claim {
  title: String
  confidence: number
  source_count: number
  last_verified: string
  contradiction_count: number
  freshness_state: "fresh" | "aging" | "stale" | "decayed"
}

interface ClaimsListProps {
  onSelectClaim: (filename: string) => void
}

export function ClaimsList({ onSelectClaim }: ClaimsListProps) {
  const project = useWikiStore((s) => s.project)
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filtering & Sorting State
  const [searchTerm, setSearchTerm] = useState("")
  const [filterState, setFilterState] = useState<string>("all")
  const [sortField, setSortField] = useState<string>("confidence")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    if (!project) return

    const fetchClaims = async () => {
      try {
        setLoading(true)
        const res = await invoke<Claim[]>("maintenance_list_claims", {
          projectPath: project.path,
        })
        // Format claims filename/slug mapping
        setClaims(res)
        setError(null)
      } catch (err) {
        console.error("Failed to load claims:", err)
        setError("Failed to load claims list")
      } finally {
        setLoading(false)
      }
    }

    fetchClaims()
  }, [project])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  // Filter & Search logic
  const filteredClaims = claims.filter((claim) => {
    const matchesSearch = claim.title.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesState = filterState === "all" || claim.freshness_state === filterState
    return matchesSearch && matchesState
  })

  // Sort logic
  const sortedClaims = [...filteredClaims].sort((a, b) => {
    let comparison = 0
    if (sortField === "confidence") {
      comparison = a.confidence - b.confidence
    } else if (sortField === "sources") {
      comparison = a.source_count - b.source_count
    } else if (sortField === "verified") {
      comparison = a.last_verified.localeCompare(b.last_verified)
    } else if (sortField === "contradictions") {
      comparison = a.contradiction_count - b.contradiction_count
    } else {
      comparison = a.title.localeCompare(b.title.toString())
    }
    return sortDirection === "asc" ? comparison : -comparison
  })

  const getFreshnessBadge = (state: string) => {
    const colors: Record<string, string> = {
      fresh: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
      aging: "bg-amber-400/10 text-amber-500 border-amber-400/20",
      stale: "bg-orange-500/10 text-orange-500 border-orange-500/20",
      decayed: "bg-destructive/10 text-destructive border-destructive/20",
    }
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${colors[state] || "bg-muted text-muted-foreground"}`}>
        {state}
      </span>
    )
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDirection === "asc" ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-muted-foreground animate-pulse">Loading claims...</span>
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
      {/* Controls: Search & Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search claims..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All States</option>
            <option value="fresh">Fresh</option>
            <option value="aging">Aging</option>
            <option value="stale">Stale</option>
            <option value="decayed">Decayed</option>
          </select>
        </div>
      </div>

      {/* Claims Table */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 font-medium text-muted-foreground">
                <th className="p-4 cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort("title")}>
                  <div className="flex items-center">Claim Assertion <SortIcon field="title" /></div>
                </th>
                <th className="p-4 cursor-pointer hover:text-foreground transition-colors text-center" onClick={() => handleSort("confidence")}>
                  <div className="flex items-center justify-center">Confidence <SortIcon field="confidence" /></div>
                </th>
                <th className="p-4 cursor-pointer hover:text-foreground transition-colors text-center" onClick={() => handleSort("sources")}>
                  <div className="flex items-center justify-center">Sources <SortIcon field="sources" /></div>
                </th>
                <th className="p-4 cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort("verified")}>
                  <div className="flex items-center">Last Verified <SortIcon field="verified" /></div>
                </th>
                <th className="p-4 cursor-pointer hover:text-foreground transition-colors text-center" onClick={() => handleSort("contradictions")}>
                  <div className="flex items-center justify-center">Contradictions <SortIcon field="contradictions" /></div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedClaims.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No claims match the filter criteria.
                  </td>
                </tr>
              ) : (
                sortedClaims.map((claim, idx) => {
                  // Deduce slug by converting title to kebab-case filename
                  const filename = `${claim.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.md`
                  return (
                    <tr
                      key={idx}
                      onClick={() => onSelectClaim(filename)}
                      className="group cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="p-4 font-medium text-foreground max-w-md truncate group-hover:text-primary transition-colors">
                        {claim.title}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="font-semibold text-foreground">
                            {Math.round(claim.confidence * 100)}%
                          </span>
                          {getFreshnessBadge(claim.freshness_state)}
                        </div>
                      </td>
                      <td className="p-4 text-center font-medium text-muted-foreground">
                        {claim.source_count}
                      </td>
                      <td className="p-4 text-muted-foreground whitespace-nowrap">
                        {claim.last_verified}
                      </td>
                      <td className="p-4 text-center">
                        {claim.contradiction_count > 0 ? (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive/10 px-1.5 text-xs font-bold text-destructive">
                            {claim.contradiction_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
