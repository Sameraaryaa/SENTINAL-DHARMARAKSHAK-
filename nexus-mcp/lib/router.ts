/**
 * NEXUS Smart Agent Router
 * Routes queries to the right subset of 50 agents based on input content and type.
 * Security agents always run. Specialists activate by keyword. Debate agents
 * activate when enough specialists are present.
 */
import { AGENT_REGISTRY } from '../agents/registry';

/**
 * Given user input and its classified type, return an ordered list of agent IDs to run.
 * The supreme_judge is always appended last.
 */
export function routeAgents(input: string, inputType: string): string[] {
  const inputLower = input.toLowerCase();
  const selected = new Set<string>();

  // ── 1. Security agents ALWAYS run (6 agents) ──────────────
  AGENT_REGISTRY.filter(a => a.alwaysRun).forEach(a => selected.add(a.id));

  // ── 2. Core analysis agents always run (4 agents) ──────────
  ['fact_checker', 'claim_extractor', 'bias_detector', 'sentiment_analyst'].forEach(id => selected.add(id));

  // ── 3. Legal document → activate ALL legal + indian_context agents ─
  if (inputType === 'legal_document') {
    AGENT_REGISTRY.filter(a => a.category === 'legal').forEach(a => selected.add(a.id));
    AGENT_REGISTRY.filter(a => a.category === 'indian_context').forEach(a => selected.add(a.id));
    // Also activate remaining analysis agents for documents
    AGENT_REGISTRY.filter(a => a.category === 'analysis').forEach(a => selected.add(a.id));
  }

  // ── 4. Keyword routing for research / legal / indian_context / analysis ─
  AGENT_REGISTRY.filter(a =>
    !a.alwaysRun &&
    a.category !== 'debate' &&
    a.id !== 'supreme_judge' &&
    a.keywords.length > 0
  ).forEach(agent => {
    if (agent.keywords.some(kw => inputLower.includes(kw.toLowerCase()))) {
      selected.add(agent.id);
    }
  });

  // ── 5. Debate agents: full set if >=10 specialists, else minimum ─
  if (selected.size >= 10) {
    AGENT_REGISTRY.filter(a => a.category === 'debate' && a.id !== 'supreme_judge').forEach(a => selected.add(a.id));
  } else {
    // Minimum debate set for even simple queries
    ['prosecutor', 'defense_counsel', 'devils_advocate', 'mediator'].forEach(id => selected.add(id));
  }

  // ── 6. Cap at 40 agents (keep supreme_judge separate) ─────
  const capped = Array.from(selected).slice(0, 40);

  // ── 7. Supreme Judge always runs last ─────────────────────
  return [...capped, 'supreme_judge'];
}
