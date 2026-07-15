# WikiMind Core Philosophy: Decay-First Knowledge

Most knowledge bases fail because they are treated as static archives. Information is dumped, and then it is forgotten. In reality, knowledge is dynamic, context-dependent, and subject to entropy. It decays. 

WikiMind is built on a single, opinionated core philosophy: **Knowledge must be managed as a living, decaying asset that undergoes continuous, autonomous self-auditing.**

## The Three Pillars of Decay-First Knowledge

### 1. Entropy is the Default
Every fact has a half-life. A statement about software versions, APIs, team structures, or system architecture is true today, but is highly likely to be false or outdated next year. Rather than treating all written text as permanently correct, WikiMind assigns a **confidence score** to every claim, which decays over time. The rate of decay is governed by the volatility of its domain (e.g., software frameworks decay faster than mathematical proofs).

### 2. Autonomous, Continuous Self-Auditing
Static knowledge bases require manual gardening, which humans inevitably neglect. WikiMind delegates this work to an autonomous maintenance loop. Scheduled background workers constantly scan the vault:
- **Decay Scan**: Automatically lowers the confidence scores of claims according to their decay formulas.
- **Re-Verification**: When a claim's confidence falls below the stale threshold, background LLM judges seek out new source materials or context to re-verify it.
- **Contradiction Resolution**: If conflicting claims are introduced, a multi-voter judge ensemble analyzes the evidence, resolves the dispute, and updates the wiki accordingly.

### 3. Review Over Erasure
Autonomous agents must not silently delete human-curated wiki pages. When auditing reveals high decay or contradictions, WikiMind creates actionable **Review Items** for the user. The system serves as a co-pilot that highlights blind spots, suggesting merges, updates, or disputes for human-in-the-loop validation.

---

By embracing confidence decay as a core mechanic, WikiMind turns knowledge management from a chore of manual cleanup into a system that stays fresh, self-corrects, and alerts you when your documentation is dying.
