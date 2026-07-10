import { useState } from "react"
import { HealthOverview } from "./health-overview"
import { ClaimsList } from "./claims-list"
import { ClaimDetail } from "./claim-detail"
import { ContradictionsPanel } from "./contradictions-panel"
import { JobHistory } from "./job-history"
import { DecayChart } from "./decay-chart"
import { ActivityTimeline } from "./activity-timeline"
import { Activity, ShieldAlert, ClipboardList, TrendingDown, Clock } from "lucide-react"

export function MaintenanceDashboard() {
  const [activeTab, setActiveTab] = useState<"claims" | "decay" | "contradictions" | "timeline" | "logs">("claims")
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null)

  const tabs = [
    { id: "claims", label: "Active Claims", icon: Activity },
    { id: "decay", label: "Decay Curves", icon: TrendingDown },
    { id: "contradictions", label: "Unresolved Disputes", icon: ShieldAlert },
    { id: "timeline", label: "Activity Timeline", icon: Clock },
    { id: "logs", label: "Audit Logs", icon: ClipboardList },
  ] as const

  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        
        {/* Header Title */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
            Autonomous Audit Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor, verify, and resolve confidence decay and contradictions in your knowledge base.
          </p>
        </div>

        {/* Health Overview Cards */}
        <HealthOverview />

        {/* Tab Selection */}
        <div className="border-b border-border/50">
          <div className="flex gap-6">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setSelectedClaim(null) // Reset claim view when switching tabs
                  }}
                  className={`flex items-center gap-2 border-b-2 px-1 pb-4 text-sm font-semibold transition-all duration-200 ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="min-h-[400px]">
          {activeTab === "claims" && (
            selectedClaim ? (
              <ClaimDetail filename={selectedClaim} onBack={() => setSelectedClaim(null)} />
            ) : (
              <ClaimsList onSelectClaim={(filename) => setSelectedClaim(filename)} />
            )
          )}
          {activeTab === "decay" && <DecayChart />}
          {activeTab === "contradictions" && <ContradictionsPanel />}
          {activeTab === "timeline" && <ActivityTimeline />}
          {activeTab === "logs" && <JobHistory />}
        </div>

      </div>
    </div>
  )
}
