import { useMemo, useState } from "react";
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  GraduationCap,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AssetType, Holding, Portfolio } from "./store";
import { TYPE_LABELS, actions, fmtPct, fmtSignedTL, fmtTL, pnl, totalCost, totalValue, usePortfolio } from "./store";
import type { AgentMemory, AgentMode, RiskLevel, Vade } from "./agentMemory";
import { clearMemory, getMemory, recordAdvice, recordQuestion, recordTurn, markAnalysisRun, updatePrefs } from "./agentMemory";
import type { TrainedFact } from "./agentTraining";
import { clearTrainedFacts, deleteTrainedFact, getTrainedFacts, markFactUsed, teach } from "./agentTraining";
import type { ChartSpec, ChatHistoryEntry, PendingAction } from "./agent";
import { INTENT_LABELS, MODE_LABELS, RISK_LABELS, VADE_LABELS, buildAnalysis, buildGreeting, chatReply, mentionedHoldingNames } from "./agent";

interface ChatMessage extends ChatHistoryEntry {
  text: string;
  chart?: ChartSpec;
  trainedFactId?: string;
  isFallback?: boolean;
  pendingAction?: PendingAction;
  actionResolved?: "confirmed" | "cancelled";
  ratable?: boolean;
  rated?: "up" | "down";
}

const CHART_COLORS = ["#2dd4a7", "#38bdf8", "#fbbf24", "#a78bfa", "#f87171", "#f472b6"];
const TOOLTIP_STYLE = { background: "#16212c", border: "1px solid rgba(148,180,200,0.2)", borderRadius: 10, fontSize: 13 };
const AXIS_TICK_STYLE = { fill: "rgba(214,228,238,0.4)", fontSize: 11 };

function ChartView({ chart }: { chart: ChartSpec }) {
  return (
    <div style={{ width: 260, marginTop: 8 }}>
      <div className="sub" style={{ marginBottom: 6, fontSize: 12, fontWeight: 600 }}>
        {chart.title}
      </div>
      {chart.kind === "pie" && (
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={chart.data} dataKey={chart.dataKey} nameKey={chart.nameKey} cx="50%" cy="50%" innerRadius={40} outerRadius={65} strokeWidth={0}>
              {chart.data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmtTL(Number(v))} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      )}
      {chart.kind === "area" && (
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={chart.data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="agentAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey={chart.nameKey}
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => new Date(v).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}
            />
            <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}K`} width={36} />
            <Tooltip formatter={(v) => fmtTL(Number(v))} contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey={chart.dataKey} stroke="#38bdf8" strokeWidth={2} fill="url(#agentAreaGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {chart.kind === "bar" && (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={chart.data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <XAxis dataKey={chart.nameKey} tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} hide={chart.data.length > 4} />
            <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}K`} width={36} />
            <Tooltip formatter={(v) => fmtTL(Number(v))} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey={chart.dataKey} radius={[4, 4, 0, 0]}>
              {chart.data.map((row, i) => (
                <Cell key={i} fill={Number(row[chart.dataKey]) >= 0 ? "#2dd4a7" : "#f87171"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function traceLayerOf(result: { trainedFactId?: string; pendingAction?: PendingAction; isFallback?: boolean; chart?: ChartSpec; intentId?: string }) {
  if (result.trainedFactId) return { layer: "Öğretilmiş bilgi", color: "#38bdf8" };
  if (result.pendingAction) return { layer: "İşlem komutu", color: "#fbbf24" };
  if (result.isFallback) return { layer: "Fallback — anlaşılmadı", color: "#f87171" };
  if (result.chart) return { layer: "Grafik üretimi", color: "#a78bfa" };
  if (result.intentId === "analiz") return { layer: "Portföy analizi", color: "#2dd4a7" };
  if (result.intentId) return { layer: `Kural: ${result.intentId}`, color: "#2dd4a7" };
  return { layer: "Built-in kural", color: "#94b4c8" };
}

interface TraceEntry {
  at: string;
  input: string;
  layer: string;
  color: string;
  intentId?: string;
  chartKind?: string;
  isFallback?: boolean;
  hasAction?: boolean;
  fromTrained?: boolean;
  ms: number;
}

function DecisionTracer({ traces, onClear }: { traces: TraceEntry[]; onClear: () => void }) {
  const fallbackCount = traces.filter((t) => t.isFallback).length;
  const understoodPct = traces.length ? Math.round(((traces.length - fallbackCount) / traces.length) * 100) : 0;
  return (
    <div className="card" style={{ borderColor: "rgba(167,139,250,0.35)" }}>
      <div className="card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={14} color="#a78bfa" /> Karar Denetleyici
        </span>
        {traces.length > 0 && (
          <button className="mini-btn" onClick={onClear}>
            <Trash2 size={11} /> Temizle
          </button>
        )}
      </div>
      {traces.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          Ajana bir şey sor — hangi katmanın cevapladığını, niyet etiketini ve süreyi burada göreceksin.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 20, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="sub" style={{ marginBottom: 2 }}>Anlaşılan</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: understoodPct >= 70 ? "var(--accent)" : "var(--red)" }}>
                %{understoodPct}
              </div>
            </div>
            <div>
              <div className="sub" style={{ marginBottom: 2 }}>Soru</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{traces.length}</div>
            </div>
            <div>
              <div className="sub" style={{ marginBottom: 2 }}>Fallback</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: fallbackCount ? "var(--red)" : "var(--faint)" }}>
                {fallbackCount}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
            {traces.map((t, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${t.color}`, paddingLeft: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: t.color }}>{t.layer}</span>
                  <span className="hint" style={{ margin: 0 }}>{t.at} · {t.ms} ms</span>
                </div>
                <div className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>"{t.input}"</div>
                <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                  {t.intentId && <span className="badge">intent: {t.intentId}</span>}
                  {t.chartKind && <span className="badge">grafik: {t.chartKind}</span>}
                  {t.fromTrained && <span className="badge badge-green">öğretilmiş</span>}
                  {t.hasAction && <span className="badge">onay bekliyor</span>}
                  {t.isFallback && <span className="badge badge-red">fallback</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PortfolioContext() {
  const portfolio = usePortfolio();
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>("hisse");
  const [amount, setAmount] = useState("");
  const [open, setOpen] = useState(true);
  const value = totalValue(portfolio);
  const cost = totalCost(portfolio);
  const { abs, pct } = pnl(value, cost);

  const add = () => {
    const parsed = Number(amount);
    if (!name.trim() || !Number.isFinite(parsed) || parsed <= 0 || actions.holdingNameExists(name)) return;
    actions.addHolding(name, type, Math.round(parsed));
    setName("");
    setAmount("");
  };

  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}
        aria-expanded={open}
      >
        <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
          <Wallet size={14} /> Portföy Bağlamı <span className="badge">{portfolio.holdings.length} varlık</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="hint" style={{ marginBottom: 10 }}>
            Ajanın gördüğü veri budur. Senaryoyu değiştir, ajanın cevabı nasıl değişiyor gör.
          </p>
          <div className="row" style={{ flexWrap: "wrap", marginBottom: 12 }}>
            <button className="mini-btn" onClick={actions.startWithSample}>Karma örnek</button>
            <button className="mini-btn" onClick={actions.startWithCryptoSample}>Kripto örnek</button>
            <button className="mini-btn" onClick={actions.startEmpty}>Boşalt</button>
          </div>
          {portfolio.holdings.length > 0 && (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
              <div>
                <div className="sub" style={{ marginBottom: 2 }}>Değer</div>
                <div className="mono" style={{ fontWeight: 600 }}>{fmtTL(value)}</div>
              </div>
              <div>
                <div className="sub" style={{ marginBottom: 2 }}>Maliyet</div>
                <div className="mono" style={{ fontWeight: 600 }}>{fmtTL(cost)}</div>
              </div>
              <div>
                <div className="sub" style={{ marginBottom: 2 }}>K/Z</div>
                <div className="mono" style={{ fontWeight: 600, color: abs >= 0 ? "var(--accent)" : "var(--red)" }}>
                  {fmtSignedTL(abs)} ({fmtPct(pct)})
                </div>
              </div>
            </div>
          )}
          {portfolio.holdings.length === 0 && <p className="sub">Portföy boş — ajan "veri yok" moduna düşer.</p>}
          {portfolio.holdings.map((h: Holding) => (
            <div className="list-row" key={h.id}>
              <span>{h.name} <span className="badge">{TYPE_LABELS[h.type]}</span></span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mono sub">{fmtTL(h.amount)}</span>
                <button aria-label={`${h.name} sil`} onClick={() => actions.removeHolding(h.id)} style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", padding: 3 }}>
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="field" htmlFor="ctx-name">Varlık adı</label>
              <input id="ctx-name" className="input" placeholder="ör. THYAO" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            </div>
            <div>
              <label className="field" htmlFor="ctx-type">Tür</label>
              <select id="ctx-type" className="select" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="field" htmlFor="ctx-amount">Tutar (TL)</label>
              <input id="ctx-amount" className="input" type="number" min="1" placeholder="10000" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            </div>
            <button className="btn btn-primary btn-inline" onClick={add} disabled={!name.trim() || !(Number(amount) > 0)}>Ekle</button>
          </div>
        </div>
      )}
    </div>
  );
}

const RISK_OPTIONS: { v: RiskLevel; label: string }[] = [
  { v: "dusuk", label: "Düşük" },
  { v: "orta", label: "Orta" },
  { v: "yuksek", label: "Yüksek" },
];
const MODE_OPTIONS: { v: AgentMode; label: string }[] = [
  { v: "temkinli", label: "Temkinli" },
  { v: "dengeli", label: "Dengeli" },
  { v: "agresif", label: "Agresif" },
];
const VADE_OPTIONS: { v: Vade; label: string }[] = [
  { v: "kisa", label: "Kısa" },
  { v: "orta", label: "Orta" },
  { v: "uzun", label: "Uzun" },
];

function AgentMemoryPanel({ mem, onPrefs }: { mem: AgentMemory; onPrefs: (partial: Partial<AgentMemory["prefs"]>) => void }) {
  const [open, setOpen] = useState(false);
  const toggleInterest = (key: string) => {
    const has = mem.prefs.interests.includes(key);
    onPrefs({ interests: has ? mem.prefs.interests.filter((i) => i !== key) : [...mem.prefs.interests, key] });
  };
  return (
    <div className="card" style={{ borderColor: "rgba(56,189,248,0.35)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}
        aria-expanded={open}
      >
        <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
          <Brain size={14} color="var(--blue)" /> Ajan Ne Biliyor?
          <span className="badge" style={{ color: "var(--blue)", borderColor: "rgba(56,189,248,0.4)" }}>HAFIZA</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ marginTop: 12 }} data-testid="agent-memory-body">
          <div className="grid-2" style={{ gap: 10 }}>
            <div>
              <label className="field" htmlFor="mem-risk">Risk seviyesi</label>
              <select id="mem-risk" className="select" value={mem.prefs.riskLevel} onChange={(e) => onPrefs({ riskLevel: e.target.value as RiskLevel })}>
                {RISK_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field" htmlFor="mem-mode">Ajan modu</label>
              <select id="mem-mode" className="select" value={mem.prefs.agentMode} onChange={(e) => onPrefs({ agentMode: e.target.value as AgentMode })}>
                {MODE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="field" htmlFor="mem-vade">Vade tercihi</label>
            <select id="mem-vade" className="select" value={mem.prefs.vade} onChange={(e) => onPrefs({ vade: e.target.value as Vade })}>
              {VADE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="field">İlgi alanların</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(TYPE_LABELS).map((key) => {
                const active = mem.prefs.interests.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="mini-btn"
                    onClick={() => toggleInterest(key)}
                    aria-pressed={active}
                    style={{ borderColor: active ? "var(--blue)" : undefined, color: active ? "var(--blue)" : undefined, fontWeight: active ? 600 : 400 }}
                  >
                    {active ? "✓ " : ""}{TYPE_LABELS[key as AssetType]}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <div className="hint" style={{ margin: "0 0 6px" }}>
              Toplam {mem.totalTurns} mesaj · son analiz: {mem.lastAnalysisAt ? new Date(mem.lastAnalysisAt).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "henüz yok"}
            </div>
            {mem.recentQuestions.length > 0 && (
              <div className="hint" style={{ margin: "0 0 6px" }}>
                Son soruların: {mem.recentQuestions.slice(0, 5).map((q) => `"${q}"`).join(" · ")}
              </div>
            )}
            {mem.recentAdvice.length > 0 && (
              <div className="hint" style={{ margin: 0 }}>
                Son öneri/uyarılarım: {mem.recentAdvice.slice(0, 3).map((a) => `“${a}”`).join(" · ")}
              </div>
            )}
          </div>
          <p className="hint" style={{ marginTop: 12, color: "var(--faint)" }}>
            🔒 Yalnızca tarayıcında saklanır. Bu bir yatırım tavsiyesi değildir.
          </p>
        </div>
      )}
    </div>
  );
}

function TeachAgentPanel({
  facts,
  onTeach,
  onDelete,
  open,
  onToggleOpen,
  q,
  a,
  onQChange,
  onAChange,
}: {
  facts: TrainedFact[];
  onTeach: (q: string, a: string) => void;
  onDelete: (id: string) => void;
  open: boolean;
  onToggleOpen: () => void;
  q: string;
  a: string;
  onQChange: (v: string) => void;
  onAChange: (v: string) => void;
}) {
  const submit = () => {
    if (!q.trim() || !a.trim()) return;
    onTeach(q, a);
  };
  return (
    <div className="card">
      <button
        onClick={onToggleOpen}
        style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
        aria-expanded={open}
      >
        <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
          <GraduationCap size={14} /> Ajanı Eğit {facts.length > 0 && <span className="badge">{facts.length}</span>}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p className="hint" style={{ marginBottom: 10 }}>
            Bir soru-cevap öğret — benzer soruda ajan önce bunu kullanır (built-in kurallardan önce). Bu bir model eğitimi değil; kelime örtüşmesine göre eşleşen sabit bir cevap kartıdır.
          </p>
          <div>
            <label className="field" htmlFor="teach-q">Soru</label>
            <input id="teach-q" className="input" placeholder='ör. "temettü nedir"' value={q} onChange={(e) => onQChange(e.target.value)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="field" htmlFor="teach-a">Cevap</label>
            <textarea id="teach-a" className="input" rows={3} style={{ resize: "vertical", fontFamily: "inherit" }} placeholder="Ajanın bu soruya vereceği cevabı yaz…" value={a} onChange={(e) => onAChange(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-inline" onClick={submit} disabled={!q.trim() || !a.trim()}>
              <GraduationCap size={15} /> Öğret
            </button>
          </div>
          {facts.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="sub" style={{ marginBottom: 8 }}>Öğretilmiş bilgiler</div>
              {facts.map((f) => (
                <div className="list-row" style={{ alignItems: "flex-start" }} key={f.id}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{f.question}</div>
                    <div className="sub" style={{ marginTop: 2, fontSize: 12.5 }}>{f.answer}</div>
                    <div className="hint" style={{ marginTop: 2 }}>{f.timesUsed} kez kullanıldı</div>
                  </div>
                  <button aria-label={`"${f.question}" öğretisini sil`} onClick={() => onDelete(f.id)} style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", padding: 4, flexShrink: 0 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function lastUserTextBefore(messages: ChatMessage[], index: number): string {
  for (let i = index - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].text;
  return "";
}

const QUICK_TESTS = ["dağılımım nasıl", "riskim ne durumda", "en çok kazandıran hangisi", "dağılımımı çiz", "kâr zarar grafiği", "beni ne hatırlıyorsun", "yardım"];

export function App() {
  const portfolio = usePortfolio();
  const [memory, setMemory] = useState<AgentMemory>(() => getMemory());
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ role: "agent", text: buildGreeting(getMemory()) }]);
  const [input, setInput] = useState("");
  const [trainedFacts, setTrainedFacts] = useState<TrainedFact[]>(() => getTrainedFacts());
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachQ, setTeachQ] = useState("");
  const [teachA, setTeachA] = useState("");
  const [traces, setTraces] = useState<TraceEntry[]>([]);

  const refreshMemory = () => setMemory(getMemory());
  const handlePrefs = (partial: Partial<AgentMemory["prefs"]>) => {
    updatePrefs(partial);
    refreshMemory();
  };
  const nowLabel = () => new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const runAnalysis = () => {
    const start = performance.now();
    recordTurn("analiz", []);
    markAnalysisRun();
    const lines = buildAnalysis(portfolio);
    if (lines[0]) recordAdvice(lines[0]);
    refreshMemory();
    const ms = Math.round(performance.now() - start);
    setTraces((prev) => [{ at: nowLabel(), input: "Portföyümü analiz et", layer: "Portföy analizi", color: "#2dd4a7", intentId: "analiz", ms }, ...prev]);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: "Portföyümü analiz et" },
      ...lines.map((text) => ({ role: "agent" as const, text, intentId: "analiz", ratable: true })),
    ]);
  };

  const sendMessage = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const start = performance.now();
    const result = chatReply(portfolio, text, messages, memory, trainedFacts);
    const ms = Math.round(performance.now() - start);
    recordTurn(result.intentId, mentionedHoldingNames(portfolio, text));
    recordQuestion(text);
    if (!result.isFallback && !result.pendingAction) recordAdvice(result.text);
    refreshMemory();
    if (result.trainedFactId) {
      markFactUsed(result.trainedFactId);
      setTrainedFacts(getTrainedFacts());
    }
    const { layer, color } = traceLayerOf(result);
    setTraces((prev) => [
      {
        at: nowLabel(),
        input: text,
        layer,
        color,
        intentId: result.intentId,
        chartKind: result.chart?.kind,
        isFallback: result.isFallback,
        hasAction: !!result.pendingAction,
        fromTrained: !!result.trainedFactId,
        ms,
      },
      ...prev,
    ]);
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      {
        role: "agent",
        text: result.text,
        chart: result.chart,
        intentId: result.intentId,
        trainedFactId: result.trainedFactId,
        isFallback: result.isFallback,
        ratable: !result.pendingAction,
        pendingAction: result.pendingAction,
      },
    ]);
    setInput("");
  };

  const resolveAction = (index: number, confirmed: boolean) => {
    const message = messages[index];
    if (!message.pendingAction || message.actionResolved) return;
    const { kind, holdingId, holdingName, amount } = message.pendingAction;
    if (!confirmed) {
      setMessages((prev) => [
        ...prev.map((m, i) => (i === index ? { ...m, actionResolved: "cancelled" as const } : m)),
        { role: "agent", text: "Tamam, işlemi iptal ettim." },
      ]);
      return;
    }
    const holding = portfolio.holdings.find((h) => h.id === holdingId);
    if (!holding) {
      setMessages((prev) => [
        ...prev.map((m, i) => (i === index ? { ...m, actionResolved: "cancelled" as const } : m)),
        { role: "agent", text: `${holdingName} artık portföyünde yok — işlemi uygulayamadım.` },
      ]);
      return;
    }
    if (kind === "satis" && amount > holding.amount) {
      setMessages((prev) => [
        ...prev.map((m, i) => (i === index ? { ...m, actionResolved: "cancelled" as const } : m)),
        { role: "agent", text: `Bakiyeyi aşamaz — ${holdingName} için güncel değer ${fmtTL(holding.amount)}. İşlemi uygulamadım.` },
      ]);
      return;
    }
    actions.addTxn(holdingId, kind, amount);
    const newAmount = kind === "alis" ? holding.amount + amount : Math.max(0, holding.amount - amount);
    setMessages((prev) => [
      ...prev.map((m, i) => (i === index ? { ...m, actionResolved: "confirmed" as const } : m)),
      { role: "agent", text: `Yaptım — ${holdingName} için ${fmtTL(amount)} ${kind === "alis" ? "alış" : "satış"} işlendi. Güncel değer: ${fmtTL(newAmount)}.` },
    ]);
  };

  const rateMessage = (index: number, rating: "up" | "down") => {
    const message = messages[index];
    if (message.role !== "agent" || !message.ratable || message.rated) return;
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, rated: rating } : m)));
    if (rating === "up") {
      if (!message.trainedFactId && !message.isFallback) {
        const question = lastUserTextBefore(messages, index);
        if (question) setTrainedFacts(teach(question, message.text));
      }
      return;
    }
    const question = lastUserTextBefore(messages, index);
    setTeachQ(question);
    setTeachA(message.trainedFactId ? message.text : "");
    setTeachOpen(true);
  };

  const resetLab = () => {
    if (!confirm("Laboratuvarı sıfırla? Portföy senaryosu, ajan hafızası ve öğretilen bilgiler silinecek.")) return;
    actions.reset();
    clearMemory();
    clearTrainedFacts();
    setMemory(getMemory());
    setTrainedFacts(getTrainedFacts());
    setMessages([{ role: "agent", text: buildGreeting(getMemory()) }]);
    setTraces([]);
  };

  const counts = useMemo(
    () => ({ mesaj: messages.length, ogretilmis: trainedFacts.length, varlik: portfolio.holdings.length }),
    [messages.length, trainedFacts.length, portfolio.holdings.length],
  );

  return (
    <div className="lab">
      <header className="lab-header">
        <div className="lab-brand">
          <FlaskConical size={18} color="var(--accent)" />
          <div>
            <div className="lab-title">FAGENT · AJAN LABORATUVARI</div>
            <div className="hint" style={{ margin: 0 }}>Bağımsız geliştirme ortamı — ana uygulamadan ayrı veri saklar.</div>
          </div>
        </div>
        <div className="lab-header-right">
          <span className="status-pill"><span className="status-dot" /> ANAHTARSIZ</span>
          <span className="hint" style={{ margin: 0 }}>{counts.mesaj} mesaj · {counts.ogretilmis} öğretilmiş · {counts.varlik} varlık</span>
          <button className="mini-btn" onClick={resetLab}><RotateCcw size={11} /> Sıfırla</button>
        </div>
      </header>
      <div className="lab-body">
        <main className="lab-col">
          <div className="card">
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Brain size={14} /> Ajan Sohbeti
            </div>
            <div className="chat-box" style={{ maxHeight: 460, overflowY: "auto" }}>
              {messages.map((m, i) => (
                <div className={`msg ${m.role === "agent" ? "msg-agent" : "msg-user"}`} key={i}>
                  {m.text}
                  {m.chart && <ChartView chart={m.chart} />}
                  {m.role === "agent" && m.pendingAction && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-inline" style={{ padding: "4px 10px", fontSize: 12.5 }} disabled={!!m.actionResolved} onClick={() => resolveAction(i, true)}>
                        {m.actionResolved === "confirmed" ? "Onaylandı ✓" : "Onayla"}
                      </button>
                      <button className="btn btn-secondary btn-inline" style={{ padding: "4px 10px", fontSize: 12.5 }} disabled={!!m.actionResolved} onClick={() => resolveAction(i, false)}>
                        {m.actionResolved === "cancelled" ? "Vazgeçildi" : "Vazgeç"}
                      </button>
                    </div>
                  )}
                  {m.role === "agent" && m.ratable && (
                    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                      <button
                        aria-label="Bu cevabı beğendim"
                        title="Beğendim"
                        disabled={!!m.rated}
                        onClick={() => rateMessage(i, "up")}
                        style={{ background: "none", border: "none", cursor: m.rated ? "default" : "pointer", padding: 3, color: m.rated === "up" ? "var(--accent)" : "var(--faint)", opacity: m.rated && m.rated !== "up" ? 0.35 : 1 }}
                      >
                        <ThumbsUp size={13} />
                      </button>
                      <button
                        aria-label="Bu cevabı beğenmedim, düzeltmek istiyorum"
                        title="Beğenmedim — düzelt"
                        disabled={!!m.rated}
                        onClick={() => rateMessage(i, "down")}
                        style={{ background: "none", border: "none", cursor: m.rated ? "default" : "pointer", padding: 3, color: m.rated === "down" ? "var(--red)" : "var(--faint)", opacity: m.rated && m.rated !== "down" ? 0.35 : 1 }}
                      >
                        <ThumbsDown size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn btn-primary btn-inline" onClick={runAnalysis}>
                <Sparkles size={15} /> Analiz Et
              </button>
            </div>
            <div className="row">
              <input
                className="input"
                placeholder={`Soru sor: "dağılım", "risk", "grafik çiz", "THYAO'dan 500 TL sat"…`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                aria-label="Ajana soru sor"
              />
              <button className="btn btn-blue btn-inline" onClick={() => sendMessage(input)} disabled={!input.trim()} aria-label="Gönder">
                <Send size={15} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              <span className="hint" style={{ margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
                <Zap size={11} /> Hızlı test:
              </span>
              {QUICK_TESTS.map((q) => (
                <button className="mini-btn" key={q} onClick={() => sendMessage(q)}>{q}</button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              Ajan yerel kurallarla çalışır (LLM değil): regex niyet algılama + kelime benzerliği. API anahtarı istemez, veri tarayıcından çıkmaz. Yanıtları yatırım tavsiyesi değildir.
            </p>
          </div>
        </main>
        <aside className="lab-col">
          <DecisionTracer traces={traces} onClear={() => setTraces([])} />
          <PortfolioContext />
          <AgentMemoryPanel mem={memory} onPrefs={handlePrefs} />
          <TeachAgentPanel
            facts={trainedFacts}
            onTeach={(q, a) => {
              setTrainedFacts(teach(q, a));
              setTeachQ("");
              setTeachA("");
            }}
            onDelete={(id) => setTrainedFacts(deleteTrainedFact(id))}
            open={teachOpen}
            onToggleOpen={() => setTeachOpen((o) => !o)}
            q={teachQ}
            a={teachA}
            onQChange={setTeachQ}
            onAChange={setTeachA}
          />
        </aside>
      </div>
    </div>
  );
}
