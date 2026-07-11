import { useEffect, useState, useMemo, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { Search, Info, TrendingDown, Check, Sparkles } from "lucide-react"

// Types matching the claims structure
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
  contradiction_count: number
  freshness_state: "fresh" | "aging" | "stale" | "decayed"
  domain_volatility: "low" | "medium" | "high" | null
  history: ClaimHistoryEntry[]
}

interface DecayChartProps {
  claim?: Claim // If provided, shows single claim detail mode
}

export function DecayChart({ claim }: DecayChartProps) {
  const project = useWikiStore((s) => s.project)
  
  // States for comparison mode
  const [allClaims, setAllClaims] = useState<Claim[]>([])
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(false)
  const [, setError] = useState<string | null>(null)

  // Hover interactions
  const [hoverData, setHoverData] = useState<{
    x: number
    y: number
    dateStr: string
    values: { title: string; confidence: number; color: string; isEvent?: boolean; event?: string }[]
  } | null>(null)
  
  const containerRef = useRef<HTMLDivElement>(null)

  // 1. Fetch claims for comparison mode
  useEffect(() => {
    if (claim || !project) return
    const fetchAll = async () => {
      try {
        setLoading(true)
        const res = await invoke<Claim[]>("maintenance_list_claims", {
          projectPath: project.path,
        })
        setAllClaims(res)
        // Automatically check the top 3 claims by default if available
        if (res.length > 0) {
          setSelectedSlugs(res.slice(0, 3).map(c => c.title))
        }
      } catch (err) {
        console.error("Failed to load claims for decay chart comparison:", err)
        setError("Failed to load claims list")
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [project, claim])

  // Helper: compute lambda effective decay rate matching Rust backend formula
  const getLambdaEff = (c: Claim) => {
    const lambda_0 = 0.01
    const volMult = c.domain_volatility === "low" ? 0.5 : c.domain_volatility === "high" ? 2.0 : 1.0
    const alpha = 0.3
    const s = c.source_count || 0
    const beta = 0.5
    const k = c.contradiction_count || 0
    return lambda_0 * volMult * (1.0 / (1.0 + alpha * s)) * (1.0 + beta * k)
  }

  // Helper: parse date to local date object
  const parseDateStr = (str: string) => {
    const parts = str.split("-")
    if (parts.length !== 3) return new Date()
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
  }

  // Helper: format Date object to YYYY-MM-DD
  const formatDateStr = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }

  // 2. Generate daily history curve points for a claim
  const generateHistoryPoints = (c: Claim, targetEndDate: Date) => {
    if (!c.history || c.history.length === 0) {
      // Fallback if no history: just create a point for verification day
      const lastVer = parseDateStr(c.last_verified)
      return [{
        date: lastVer,
        dateStr: c.last_verified,
        confidence: c.confidence,
        isEvent: true,
        event: "initial_extraction"
      }]
    }

    const sortedHistory = [...c.history].sort((a, b) => a.date.localeCompare(b.date))
    const points: { date: Date; dateStr: string; confidence: number; isEvent: boolean; event?: string; note?: string | null }[] = []
    const lambdaEff = getLambdaEff(c)

    // Map of events by date
    const eventMap = new Map<string, ClaimHistoryEntry>()
    for (const h of sortedHistory) {
      eventMap.set(h.date, h)
    }

    const startDate = parseDateStr(sortedHistory[0].date)
    let currentDate = new Date(startDate)

    let lastEventDate = new Date(startDate)
    let lastEventConfidence = sortedHistory[0].confidence

    while (currentDate <= targetEndDate) {
      const dateStr = formatDateStr(currentDate)
      const eventOnDay = eventMap.get(dateStr)

      if (eventOnDay) {
        lastEventConfidence = eventOnDay.confidence
        lastEventDate = new Date(currentDate)
        points.push({
          date: new Date(currentDate),
          dateStr,
          confidence: lastEventConfidence,
          isEvent: true,
          event: eventOnDay.event,
          note: eventOnDay.note
        })
      } else {
        const deltaDays = Math.max(0, Math.round((currentDate.getTime() - lastEventDate.getTime()) / (1000 * 60 * 60 * 24)))
        const decayedConf = lastEventConfidence * Math.exp(-lambdaEff * deltaDays)
        points.push({
          date: new Date(currentDate),
          dateStr,
          confidence: Math.max(0.0, Math.min(1.0, decayedConf)),
          isEvent: false
        })
      }

      // Increment day
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return points
  }

  // 3. Compute chart scale parameters
  const activeClaims = useMemo(() => {
    if (claim) return [claim]
    return allClaims.filter(c => selectedSlugs.includes(c.title))
  }, [claim, allClaims, selectedSlugs])

  // Shared date range
  const dateRange = useMemo(() => {
    if (activeClaims.length === 0) return { start: new Date(), end: new Date(), list: [] }
    
    // Earliest date in all active claims' history
    let earliest = new Date()
    for (const c of activeClaims) {
      const h = c.history || []
      if (h.length > 0) {
        const d = parseDateStr(h[0].date)
        if (d < earliest) earliest = d
      } else {
        const d = parseDateStr(c.last_verified)
        if (d < earliest) earliest = d
      }
    }

    const today = new Date()
    const list: string[] = []
    const start = new Date(earliest)
    const end = new Date(today)
    
    // Safety check: limit to max 365 days of history
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    if (diffDays > 365) {
      start.setDate(end.getDate() - 365)
    }

    const temp = new Date(start)
    while (temp <= end) {
      list.push(formatDateStr(temp))
      temp.setDate(temp.getDate() + 1)
    }

    return { start, end, list }
  }, [activeClaims])

  // Generate curves data for active claims
  const curvesData = useMemo(() => {
    if (activeClaims.length === 0 || dateRange.list.length === 0) return []
    return activeClaims.map((c, idx) => {
      const points = generateHistoryPoints(c, dateRange.end)
      // Map back onto the shared date range list
      const pointsMap = new Map<string, typeof points[0]>()
      for (const p of points) {
        pointsMap.set(p.dateStr, p)
      }

      // If single claim detail mode, also generate future 90 days projection
      const projectionPoints: { dateStr: string; confidence: number }[] = []
      if (claim && idx === 0) {
        const lambdaEff = getLambdaEff(c)
        const baseConf = c.confidence
        for (let d = 1; d <= 90; d++) {
          const futureDate = new Date(dateRange.end)
          futureDate.setDate(futureDate.getDate() + d)
          const decayed = baseConf * Math.exp(-lambdaEff * d)
          projectionPoints.push({
            dateStr: formatDateStr(futureDate),
            confidence: Math.max(0.0, Math.min(1.0, decayed))
          })
        }
      }

      // Visual lines colors
      const colors = [
        "stroke-emerald-500 fill-emerald-500", // Emerald
        "stroke-violet-500 fill-violet-500",   // Violet
        "stroke-sky-500 fill-sky-500",         // Sky blue
        "stroke-amber-500 fill-amber-500",     // Amber
        "stroke-pink-500 fill-pink-500",       // Pink
        "stroke-orange-500 fill-orange-500",   // Orange
      ]
      const bgColors = [
        "bg-emerald-500",
        "bg-violet-500",
        "bg-sky-500",
        "bg-amber-500",
        "bg-pink-500",
        "bg-orange-500",
      ]

      return {
        claim: c,
        points: dateRange.list.map(dStr => {
          const match = pointsMap.get(dStr)
          return {
            dateStr: dStr,
            confidence: match ? match.confidence : null,
            isEvent: match ? match.isEvent : false,
            event: match ? match.event : undefined,
            note: match ? match.note : null
          }
        }),
        projectionPoints,
        colorClass: colors[idx % colors.length],
        bgColorClass: bgColors[idx % bgColors.length]
      }
    })
  }, [activeClaims, dateRange, claim])

  // Filtered claims list for search box
  const filteredClaimsList = allClaims.filter(c => 
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Coordinate scales inside SVG (using viewBox="0 0 800 400" for comparison, "0 0 600 280" for detail)
  const svgWidth = claim ? 600 : 800
  const svgHeight = claim ? 280 : 380
  const paddingLeft = 50
  const paddingRight = claim ? 80 : 40
  const paddingTop = 30
  const paddingBottom = 40

  const drawWidth = svgWidth - paddingLeft - paddingRight
  const drawHeight = svgHeight - paddingTop - paddingBottom

  // Coordinates helpers
  const getX = (idx: number, total: number) => {
    return paddingLeft + (idx / Math.max(1, total - 1)) * drawWidth
  }
  
  const getY = (val: number) => {
    return svgHeight - paddingBottom - val * drawHeight
  }

  // Handle SVG Mouse Interactivity (Vertical Guideline & Tooltip)
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeClaims.length === 0 || curvesData.length === 0 || !containerRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left - (paddingLeft / svgWidth) * rect.width) / ((drawWidth / svgWidth) * rect.width)
    const totalDays = dateRange.list.length

    let idx = Math.round(xRatio * (totalDays - 1))
    
    // Also support hover for future projection points in single claim view
    let isProjection = false
    let projIdx = -1
    if (claim && curvesData[0].projectionPoints.length > 0 && idx >= totalDays) {
      isProjection = true
      const projXRatio = (e.clientX - rect.left - ((paddingLeft + drawWidth) / svgWidth) * rect.width) / ((paddingRight / svgWidth) * rect.width)
      projIdx = Math.round(projXRatio * (curvesData[0].projectionPoints.length - 1))
      if (projIdx < 0) {
        idx = totalDays - 1
        isProjection = false
      }
    }

    idx = Math.max(0, Math.min(totalDays - 1, idx))

    // Build values list
    const values: any[] = []
    let dateStr = ""
    let tooltipX = 0
    let tooltipY = 0

    if (isProjection && curvesData[0].projectionPoints[projIdx]) {
      const pt = curvesData[0].projectionPoints[projIdx]
      dateStr = pt.dateStr
      values.push({
        title: (claim?.title || "") + " (Projected)",
        confidence: pt.confidence,
        color: "bg-primary border-primary",
      })
      tooltipX = paddingLeft + drawWidth + (projIdx / (curvesData[0].projectionPoints.length - 1)) * paddingRight
      tooltipY = getY(pt.confidence)
    } else {
      dateStr = dateRange.list[idx]
      for (const curve of curvesData) {
        const pt = curve.points[idx]
        if (pt && pt.confidence !== null) {
          values.push({
            title: curve.claim.title,
            confidence: pt.confidence,
            color: curve.bgColorClass,
            isEvent: pt.isEvent,
            event: pt.event
          })
          tooltipY = getY(pt.confidence) // Use last mapped Y
        }
      }
      tooltipX = getX(idx, totalDays)
    }

    if (values.length > 0) {
      setHoverData({
        x: tooltipX,
        y: tooltipY,
        dateStr,
        values
      })
    }
  }

  const handleMouseLeave = () => {
    setHoverData(null)
  }

  // Draw Horizontal threshold markers
  const yFresh = getY(0.7)
  const yStale = getY(0.4)
  const yDecayed = getY(0.2)

  return (
    <div ref={containerRef} className="relative flex flex-col lg:flex-row gap-6">
      
      {/* 1. Left Selection Column (Only in Comparison Mode) */}
      {!claim && (
        <div className="w-full lg:w-64 shrink-0 rounded-xl border border-border/50 bg-card p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Claims</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
              {selectedSlugs.length} / {allClaims.length}
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search claims..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-input bg-background py-1 pl-8 pr-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1 max-h-[250px] overflow-y-auto pr-1">
            {loading ? (
              <span className="text-xs text-muted-foreground block text-center py-4">Loading claims list...</span>
            ) : filteredClaimsList.length === 0 ? (
              <span className="text-xs text-muted-foreground block text-center py-4">No matching claims.</span>
            ) : (
              filteredClaimsList.map(c => {
                const isChecked = selectedSlugs.includes(c.title)
                return (
                  <button
                    key={c.title}
                    onClick={() => {
                      setSelectedSlugs(prev => 
                        isChecked ? prev.filter(s => s !== c.title) : [...prev, c.title]
                      )
                    }}
                    className={`flex items-center gap-2 w-full text-left rounded p-2 text-xs transition-colors hover:bg-muted/50 ${
                      isChecked ? "bg-accent/30 font-medium" : ""
                    }`}
                  >
                    <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary transition-all ${
                      isChecked ? "bg-primary text-primary-foreground" : "bg-background"
                    }`}>
                      {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className="truncate flex-1">{c.title}</span>
                    <span className={`text-[9px] px-1 rounded-sm uppercase ${
                      c.freshness_state === "fresh" ? "bg-emerald-500/10 text-emerald-500" :
                      c.freshness_state === "aging" ? "bg-amber-500/10 text-amber-500" :
                      c.freshness_state === "stale" ? "bg-orange-500/10 text-orange-500" :
                      "bg-destructive/10 text-destructive"
                    }`}>
                      {c.freshness_state}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 2. Right Canvas Area */}
      <div className="flex-1 rounded-xl border border-border/50 bg-card p-6 shadow-sm flex flex-col justify-between">
        
        {/* Title / Description */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">
              {claim ? "Historical Confidence & Decay Projection" : "Vault Decay Comparison Overlay"}
            </h4>
          </div>
          {!claim && selectedSlugs.length === 0 && (
            <span className="text-xs text-amber-500 flex items-center gap-1"><Info className="h-3.5 w-3.5" /> Check claims to display overlay.</span>
          )}
        </div>

        {/* Chart SVG wrapper */}
        <div className="relative w-full">
          {activeClaims.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[260px] border border-dashed border-border/40 rounded-lg text-center bg-muted/5">
              <TrendingDown className="h-8 w-8 text-muted-foreground/60 mb-2 stroke-[1.5]" />
              <p className="text-xs text-muted-foreground max-w-xs">
                Select claims from the list on the left to draw their confidence decay curves and compare verifications.
              </p>
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full overflow-visible select-none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Gridlines */}
              <line x1={paddingLeft} y1={svgHeight - paddingBottom} x2={paddingLeft + drawWidth} y2={svgHeight - paddingBottom} className="stroke-muted/20" strokeWidth="1" />
              <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={svgHeight - paddingBottom} className="stroke-muted/20" strokeWidth="1" />

              {/* Decay threshold lines */}
              <line x1={paddingLeft} y1={yFresh} x2={paddingLeft + drawWidth} y2={yFresh} className="stroke-emerald-500/10" strokeWidth="1" strokeDasharray="3 3" />
              <line x1={paddingLeft} y1={yStale} x2={paddingLeft + drawWidth} y2={yStale} className="stroke-amber-400/10" strokeWidth="1" strokeDasharray="3 3" />
              <line x1={paddingLeft} y1={yDecayed} x2={paddingLeft + drawWidth} y2={yDecayed} className="stroke-orange-500/10" strokeWidth="1" strokeDasharray="3 3" />

              <text x={paddingLeft - 10} y={yFresh + 3} className="fill-emerald-500/40 text-[8px] text-right font-medium" textAnchor="end">70% (Fresh)</text>
              <text x={paddingLeft - 10} y={yStale + 3} className="fill-amber-500/40 text-[8px] text-right font-medium" textAnchor="end">40% (Aging)</text>
              <text x={paddingLeft - 10} y={yDecayed + 3} className="fill-orange-500/40 text-[8px] text-right font-medium" textAnchor="end">20% (Stale)</text>

              {/* X & Y Axis Labels */}
              <text x={paddingLeft} y={svgHeight - paddingBottom + 16} className="fill-muted-foreground/60 text-[9px]">{dateRange.list[0]}</text>
              <text x={paddingLeft + drawWidth / 2} y={svgHeight - paddingBottom + 16} className="fill-muted-foreground/60 text-[9px]" textAnchor="middle">Chronological History</text>
              <text x={paddingLeft + drawWidth} y={svgHeight - paddingBottom + 16} className="fill-muted-foreground/60 text-[9px]" textAnchor="end">Today ({dateRange.list[dateRange.list.length - 1]})</text>
              
              <text x={paddingLeft - 8} y={getY(1.0) + 3} className="fill-muted-foreground/60 text-[9px]" textAnchor="end">1.0</text>
              <text x={paddingLeft - 8} y={getY(0.5) + 3} className="fill-muted-foreground/60 text-[9px]" textAnchor="end">0.5</text>
              <text x={paddingLeft - 8} y={getY(0.0) + 3} className="fill-muted-foreground/60 text-[9px]" textAnchor="end">0.0</text>

              {/* Draw Claims Curves */}
              {curvesData.map((curve, idx) => {
                const totalPoints = curve.points.length
                
                // Build path string
                let pathD = ""
                let isFirst = true

                curve.points.forEach((p, pIdx) => {
                  if (p.confidence !== null) {
                    const x = getX(pIdx, totalPoints)
                    const y = getY(p.confidence)
                    if (isFirst) {
                      pathD = `M ${x} ${y}`
                      isFirst = false
                    } else {
                      pathD += ` L ${x} ${y}`
                    }
                  }
                })

                // Projection path (Single Claim mode only)
                let projPathD = ""
                if (claim && curve.projectionPoints.length > 0) {
                  const xStart = getX(totalPoints - 1, totalPoints)
                  const yStart = getY(curve.points[totalPoints - 1].confidence || 0)
                  projPathD = `M ${xStart} ${yStart}`
                  
                  curve.projectionPoints.forEach((p, pIdx) => {
                    const x = paddingLeft + drawWidth + (pIdx / (curve.projectionPoints.length - 1)) * paddingRight
                    const y = getY(p.confidence)
                    projPathD += ` L ${x} ${y}`
                  })
                }

                return (
                  <g key={idx}>
                    {/* The line path */}
                    {pathD && (
                      <path
                        d={pathD}
                        className={`fill-none ${curve.colorClass} stroke-[2]`}
                        filter={claim ? "url(#glow)" : undefined}
                      />
                    )}

                    {/* Dotted projection path */}
                    {claim && projPathD && (
                      <>
                        <path
                          d={projPathD}
                          className="fill-none stroke-primary/50 stroke-[2]"
                          strokeDasharray="4 4"
                        />
                        {/* Projection end-point */}
                        <circle
                          cx={paddingLeft + drawWidth + paddingRight}
                          cy={getY(curve.projectionPoints[curve.projectionPoints.length - 1].confidence)}
                          r="3"
                          className="fill-primary/70 stroke-background"
                          strokeWidth="1.5"
                        />
                        <text
                          x={paddingLeft + drawWidth + paddingRight}
                          y={getY(curve.projectionPoints[curve.projectionPoints.length - 1].confidence) - 8}
                          className="fill-primary/80 text-[8px] font-bold"
                          textAnchor="end"
                        >
                          +90d
                        </text>
                      </>
                    )}

                    {/* Event Circles */}
                    {curve.points.map((p, pIdx) => {
                      if (p.isEvent && p.confidence !== null) {
                        const cx = getX(pIdx, totalPoints)
                        const cy = getY(p.confidence)
                        return (
                          <g key={pIdx} className="cursor-pointer group/node">
                            <circle
                              cx={cx}
                              cy={cy}
                              r={claim ? "5" : "3.5"}
                              className={`${curve.colorClass} stroke-background`}
                              strokeWidth="2"
                            />
                            {/* Hover concentric circle */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r="9"
                              className="fill-none stroke-current opacity-0 group-hover/node:opacity-30 transition-opacity"
                              strokeWidth="1"
                            />
                          </g>
                        )
                      }
                      return null
                    })}
                  </g>
                )
              })}

              {/* Hover Guide Line */}
              {hoverData && (
                <line
                  x1={hoverData.x}
                  y1={paddingTop}
                  x2={hoverData.x}
                  y2={svgHeight - paddingBottom}
                  className="stroke-muted-foreground/30"
                  strokeDasharray="3 3"
                />
              )}
            </svg>
          )}

          {/* Floating Tooltip */}
          {hoverData && (
            <div
              className="absolute pointer-events-none rounded-lg border border-border/80 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md transition-all duration-75 space-y-1.5"
              style={{
                left: `${(hoverData.x / svgWidth) * 100}%`,
                top: `${(hoverData.y / svgHeight) * 100 - 15}%`,
                transform: "translate(-50%, -100%)",
                minWidth: "160px",
                zIndex: 50
              }}
            >
              <div className="flex justify-between border-b pb-1 text-[10px] font-bold text-muted-foreground">
                <span>{hoverData.dateStr}</span>
              </div>
              <div className="space-y-1">
                {hoverData.values.map((v, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${v.color}`} />
                      <span className="truncate text-foreground/90 leading-none">{v.title}</span>
                    </div>
                    <span className="font-bold font-mono shrink-0">
                      {Math.round(v.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
              
              {/* Event detail description in single mode */}
              {claim && hoverData.values[0]?.isEvent && (
                <div className="border-t pt-1 mt-1 text-[9px] bg-primary/5 p-1 rounded border border-primary/20 text-primary font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span className="capitalize leading-none">
                    {hoverData.values[0].event?.replace("_", " ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        {activeClaims.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[10px]">
            {curvesData.map((c, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${c.bgColorClass}`} />
                <span className="font-semibold text-muted-foreground truncate max-w-[150px]">
                  {c.claim.title}
                </span>
                <span className="font-mono text-foreground font-bold">
                  ({Math.round(c.claim.confidence * 100)}%)
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
