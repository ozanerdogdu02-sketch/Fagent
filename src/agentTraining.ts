const TRAINING_KEY = "fagent.lab.agent.training.v1";
const JACCARD_THRESHOLD = 0.5;

export interface TrainedFact {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  timesUsed: number;
}

function loadTrainedFacts(): TrainedFact[] {
  try {
    const raw = localStorage.getItem(TRAINING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTrainedFacts(facts: TrainedFact[]) {
  localStorage.setItem(TRAINING_KEY, JSON.stringify(facts));
}

export function getTrainedFacts(): TrainedFact[] {
  return loadTrainedFacts();
}

function normalizeQuestion(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[?!.,;:]/g, "")
    .replace(/\s+/g, " ");
}

export function teach(question: string, answer: string): TrainedFact[] {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return loadTrainedFacts();
  const facts = loadTrainedFacts();
  const normalized = normalizeQuestion(q);
  const existingIdx = facts.findIndex((f) => normalizeQuestion(f.question) === normalized);
  if (existingIdx >= 0) {
    facts[existingIdx] = { ...facts[existingIdx], question: q, answer: a };
  } else {
    facts.unshift({ id: `f${Date.now()}`, question: q, answer: a, createdAt: new Date().toISOString(), timesUsed: 0 });
  }
  saveTrainedFacts(facts);
  return facts;
}

export function deleteTrainedFact(id: string): TrainedFact[] {
  const facts = loadTrainedFacts().filter((f) => f.id !== id);
  saveTrainedFacts(facts);
  return facts;
}

export function markFactUsed(id: string) {
  const facts = loadTrainedFacts();
  const idx = facts.findIndex((f) => f.id === id);
  if (idx < 0) return;
  facts[idx] = { ...facts[idx], timesUsed: facts[idx].timesUsed + 1 };
  saveTrainedFacts(facts);
}

export function clearTrainedFacts() {
  localStorage.removeItem(TRAINING_KEY);
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeQuestion(text).split(" ").filter((w) => w.length > 0));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findBestMatch(facts: TrainedFact[], question: string): TrainedFact | undefined {
  const q = question.trim();
  if (!q || facts.length === 0) return undefined;
  const normalized = normalizeQuestion(q);
  const exact = facts.find((f) => normalizeQuestion(f.question) === normalized);
  if (exact) return exact;
  const questionWords = wordSet(q);
  let best: TrainedFact | undefined;
  let bestScore = 0;
  for (const fact of facts) {
    const score = jaccardSimilarity(questionWords, wordSet(fact.question));
    if (score > bestScore) {
      bestScore = score;
      best = fact;
    }
  }
  return bestScore >= JACCARD_THRESHOLD ? best : undefined;
}
