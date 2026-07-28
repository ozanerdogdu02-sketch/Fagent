const MEMORY_KEY = "fagent.lab.agent.memory.v1";
const MAX_RECENT = 5;

export type RiskLevel = "dusuk" | "orta" | "yuksek";
export type AgentMode = "temkinli" | "dengeli" | "agresif";
export type Vade = "kisa" | "orta" | "uzun";

export interface AgentPrefs {
  riskLevel: RiskLevel;
  agentMode: AgentMode;
  vade: Vade;
  interests: string[];
}

export interface AgentMemory {
  topicCounts: Record<string, number>;
  holdingMentions: Record<string, number>;
  totalTurns: number;
  firstSeenAt: string;
  lastSeenAt: string;
  prefs: AgentPrefs;
  recentQuestions: string[];
  recentAdvice: string[];
  lastAnalysisAt: string;
}

function defaultPrefs(): AgentPrefs {
  return { riskLevel: "orta", agentMode: "dengeli", vade: "orta", interests: [] };
}

function defaultMemory(): AgentMemory {
  return {
    topicCounts: {},
    holdingMentions: {},
    totalTurns: 0,
    firstSeenAt: "",
    lastSeenAt: "",
    prefs: defaultPrefs(),
    recentQuestions: [],
    recentAdvice: [],
    lastAnalysisAt: "",
  };
}

function loadMemory(): AgentMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return defaultMemory();
    const parsed = JSON.parse(raw);
    const defaults = defaultPrefs();
    const prefs = parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {};
    return {
      topicCounts: parsed.topicCounts && typeof parsed.topicCounts === "object" ? parsed.topicCounts : {},
      holdingMentions: parsed.holdingMentions && typeof parsed.holdingMentions === "object" ? parsed.holdingMentions : {},
      totalTurns: typeof parsed.totalTurns === "number" ? parsed.totalTurns : 0,
      firstSeenAt: parsed.firstSeenAt ?? "",
      lastSeenAt: parsed.lastSeenAt ?? "",
      prefs: {
        riskLevel: prefs.riskLevel ?? defaults.riskLevel,
        agentMode: prefs.agentMode ?? defaults.agentMode,
        vade: prefs.vade ?? defaults.vade,
        interests: Array.isArray(prefs.interests) ? prefs.interests : defaults.interests,
      },
      recentQuestions: Array.isArray(parsed.recentQuestions) ? parsed.recentQuestions.slice(0, MAX_RECENT) : [],
      recentAdvice: Array.isArray(parsed.recentAdvice) ? parsed.recentAdvice.slice(0, MAX_RECENT) : [],
      lastAnalysisAt: parsed.lastAnalysisAt ?? "",
    };
  } catch {
    return defaultMemory();
  }
}

function saveMemory(memory: AgentMemory) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
}

export function getMemory(): AgentMemory {
  return loadMemory();
}

export function recordTurn(intentId: string | undefined, mentionedHoldingNames: string[]): AgentMemory {
  const memory = loadMemory();
  const now = new Date().toISOString();
  memory.totalTurns += 1;
  if (!memory.firstSeenAt) memory.firstSeenAt = now;
  memory.lastSeenAt = now;
  if (intentId) memory.topicCounts[intentId] = (memory.topicCounts[intentId] ?? 0) + 1;
  for (const name of mentionedHoldingNames) memory.holdingMentions[name] = (memory.holdingMentions[name] ?? 0) + 1;
  saveMemory(memory);
  return memory;
}

export function updatePrefs(partial: Partial<AgentPrefs>): AgentMemory {
  const memory = loadMemory();
  memory.prefs = { ...memory.prefs, ...partial };
  saveMemory(memory);
  return memory;
}

function pushRecent(list: string[], item: string, cap = MAX_RECENT): string[] {
  const trimmed = item.trim();
  if (!trimmed || list[0] === trimmed) return list;
  return [trimmed, ...list.filter((x) => x !== trimmed)].slice(0, cap);
}

export function recordQuestion(question: string): AgentMemory {
  const memory = loadMemory();
  memory.recentQuestions = pushRecent(memory.recentQuestions, question);
  saveMemory(memory);
  return memory;
}

export function recordAdvice(text: string): AgentMemory {
  const memory = loadMemory();
  const truncated = text.length > 160 ? text.slice(0, 157).trimEnd() + "…" : text;
  memory.recentAdvice = pushRecent(memory.recentAdvice, truncated);
  saveMemory(memory);
  return memory;
}

export function markAnalysisRun(): AgentMemory {
  const memory = loadMemory();
  memory.lastAnalysisAt = new Date().toISOString();
  saveMemory(memory);
  return memory;
}

export function topTopic(memory: AgentMemory): string | undefined {
  const entries = Object.entries(memory.topicCounts);
  if (entries.length) return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function topMentionedHolding(memory: AgentMemory): string | undefined {
  const entries = Object.entries(memory.holdingMentions);
  if (entries.length) return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function clearMemory() {
  localStorage.removeItem(MEMORY_KEY);
}
