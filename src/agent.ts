import type { AssetType, Holding, Portfolio } from "./store";
import { TYPE_LABELS, fmtPct, fmtSignedTL, fmtTL, netInvestmentHistory, pnl, totalValue } from "./store";
import type { AgentMemory, AgentMode, RiskLevel, Vade } from "./agentMemory";
import type { TrainedFact } from "./agentTraining";
import { findBestMatch } from "./agentTraining";

// agent.ts is deliberately pure: no localStorage, no network I/O. All state
// (portfolio, history, memory, trained facts) is passed in as parameters.

export type ChartKind = "pie" | "area" | "bar";

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  dataKey: string;
  nameKey: string;
  data: Record<string, string | number>[];
}

export interface PendingAction {
  kind: "alis" | "satis";
  holdingId: string;
  holdingName: string;
  amount: number;
}

export interface ChatReplyResult {
  text: string;
  chart?: ChartSpec;
  intentId?: string;
  isFallback?: boolean;
  pendingAction?: PendingAction;
  trainedFactId?: string;
}

export interface ChatHistoryEntry {
  role: "user" | "agent";
  intentId?: string;
}

export const INTENT_LABELS: Record<string, string> = {
  analiz: "genel analiz",
  dagilim: "sınıf dağılımı",
  "grafik-dagilim": "dağılım grafiği",
  "grafik-yatirim": "yatırım geçmişi grafiği",
  "grafik-pnl": "kâr/zarar grafiği",
  trained: "senin öğrettiğin bir konu",
};

export const RISK_LABELS: Record<RiskLevel, string> = { dusuk: "düşük", orta: "orta", yuksek: "yüksek" };
export const MODE_LABELS: Record<AgentMode, string> = { temkinli: "temkinli", dengeli: "dengeli", agresif: "agresif" };
export const VADE_LABELS: Record<Vade, string> = { kisa: "kısa", orta: "orta", uzun: "uzun" };

export function mentionedHoldingNames(portfolio: Portfolio, text: string): string[] {
  const lower = text.toLocaleLowerCase("tr-TR");
  return portfolio.holdings.filter((h) => lower.includes(h.name.toLocaleLowerCase("tr-TR"))).map((h) => h.name);
}

interface AllocationSlice {
  type: AssetType;
  amount: number;
  pct: number;
}

export function allocationByType(portfolio: Portfolio): AllocationSlice[] {
  const total = totalValue(portfolio);
  const byType = new Map<AssetType, number>();
  for (const h of portfolio.holdings) byType.set(h.type, (byType.get(h.type) ?? 0) + h.amount);
  return [...byType.entries()]
    .map(([type, amount]) => ({ type, amount, pct: total ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

const STABLECOIN_IDS = new Set(["tether", "usd-coin", "dai", "binance-usd", "true-usd"]);
const STABLECOIN_NAME_REGEX = /\b(usdt|usdc|tether|dai|busd|tusd|fdusd|stablecoin)\b/i;

function isStablecoin(holding: Holding): boolean {
  if (holding.type !== "kripto") return false;
  if (holding.symbol && STABLECOIN_IDS.has(holding.symbol)) return true;
  return STABLECOIN_NAME_REGEX.test(holding.name);
}

export function buildAnalysis(portfolio: Portfolio): string[] {
  const total = totalValue(portfolio);
  if (!portfolio.holdings.length) {
    return ["Portföyün henüz boş. Panel sekmesinden varlık ekle ya da örnek veriyle başla, sonra tekrar analiz edelim."];
  }
  const allocation = allocationByType(portfolio);
  const largest = allocation[0];
  const lines: string[] = [];
  lines.push(
    `Portföy özeti: toplam ${fmtTL(total)}, ${portfolio.holdings.length} varlık, ${allocation.length} farklı sınıf. En büyük ağırlık ${TYPE_LABELS[largest.type]} (%${largest.pct.toFixed(0)}).`,
  );
  if (largest.pct > 50) {
    lines.push(
      `⚠ Konsantrasyon uyarısı: portföyün yarısından fazlası tek sınıfta (${TYPE_LABELS[largest.type]}). Bu sınıf değer kaybederse toplam portföy sert etkilenir; ağırlığı kademeli azaltmayı değerlendirebilirsin.`,
    );
  } else if (allocation.length >= 4) {
    lines.push("✓ Çeşitlendirme iyi görünüyor: dört veya daha fazla varlık sınıfına yayılmışsın, tek bir şoka bağımlılık düşük.");
  } else {
    lines.push("Çeşitlendirme orta düzeyde. Farklı davranan sınıflar (ör. altın + hisse + mevduat) birlikte tutulduğunda dalgalanma yumuşar.");
  }

  const stableAmount = portfolio.holdings.filter(isStablecoin).reduce((sum, h) => sum + h.amount, 0);
  const stablePct = total > 0 ? (stableAmount / total) * 100 : 0;
  const cashLikePct =
    allocation.filter((a) => a.type === "mevduat" || a.type === "doviz").reduce((sum, a) => sum + a.pct, 0) + stablePct;
  const cashLikeLabel = stablePct > 0 ? "mevduat/döviz/stablecoin" : "mevduat/döviz";
  if (cashLikePct < 10) {
    lines.push(`Nakit benzeri (${cashLikeLabel}) oranın %10'un altında — acil durum tamponu için biraz likidite ayırmak rahatlatır.`);
  } else if (cashLikePct > 60) {
    lines.push(`Nakit benzeri ağırlık yüksek (%${cashLikePct.toFixed(0)}). Enflasyonist ortamda uzun vadede reel getiri erimesi riskine dikkat.`);
  } else if (stablePct >= 10) {
    lines.push(`Portföyünün %${stablePct.toFixed(0)}'ı stablecoin — bunu nakit pozisyonu olarak sayıyorum, dalgalanmaya karşı tamponun var.`);
  }

  const recentSells = portfolio.txns.slice(0, 10).filter((t) => t.kind === "satis").length;
  const recentBuys = portfolio.txns.slice(0, 10).filter((t) => t.kind === "alis").length;
  if (recentBuys + recentSells >= 3) {
    lines.push(
      recentSells > recentBuys
        ? "Son işlemlerinde satış ağırlığı var — plan dahilindeyse sorun yok, ama panik satışları uzun vadeli getiriyi en çok aşındıran davranıştır."
        : "Son işlemlerin alım ağırlıklı — düzenli alım (maliyet ortalaması) zamanlama riskini azaltan sağlam bir disiplindir.",
    );
  }

  lines.push("Not: Bu analiz demo ajan tarafından yerel kurallarla üretildi; yatırım tavsiyesi değildir.");
  return lines;
}

export function allocationChart(portfolio: Portfolio): ChartSpec | undefined {
  const allocation = allocationByType(portfolio);
  if (!allocation.length) return undefined;
  return {
    kind: "pie",
    title: "Sınıf Dağılımı",
    dataKey: "value",
    nameKey: "name",
    data: allocation.map((a) => ({ name: TYPE_LABELS[a.type], value: Math.round(a.amount) })),
  };
}

export function investmentHistoryChart(portfolio: Portfolio): ChartSpec | undefined {
  const history = netInvestmentHistory(portfolio);
  if (history.length < 2) return undefined;
  return {
    kind: "area",
    title: "Net Yatırım Tutarı Geçmişi",
    dataKey: "tutar",
    nameKey: "tarih",
    data: history.map((h) => ({ tarih: h.tarih, tutar: Math.round(h.tutar) })),
  };
}

export function pnlBarChart(portfolio: Portfolio): ChartSpec | undefined {
  if (!portfolio.holdings.length) return undefined;
  return {
    kind: "bar",
    title: "Varlık Bazlı Kâr/Zarar",
    dataKey: "deger",
    nameKey: "name",
    data: portfolio.holdings.map((h) => ({ name: h.name, deger: Math.round(h.amount - h.costBasis) })),
  };
}

export function detectChartRequest(portfolio: Portfolio, text: string): { chart: ChartSpec; intentId: string } | undefined {
  if (!/graf|çiz|görselleştir|görsel|chart|pasta/i.test(text)) return undefined;
  if (/kâr|kar|zarar|karşılaştır|kıyasla|bazlı/i.test(text)) {
    const chart = pnlBarChart(portfolio);
    return chart ? { chart, intentId: "grafik-pnl" } : undefined;
  }
  if (/yatırım|trend|net|geçmiş|birikim/i.test(text)) {
    const chart = investmentHistoryChart(portfolio);
    return chart ? { chart, intentId: "grafik-yatirim" } : undefined;
  }
  const chart = allocationChart(portfolio) ?? investmentHistoryChart(portfolio);
  return chart ? { chart, intentId: chart.title === "Sınıf Dağılımı" ? "grafik-dagilim" : "grafik-yatirim" } : undefined;
}

export function detectTradeIntent(portfolio: Portfolio, text: string): PendingAction | undefined {
  const amountMatch = text.match(/(\d[\d.,]*)\s*(tl|₺)?/i);
  if (!amountMatch) return undefined;
  const normalized = amountMatch[1].replace(/\./g, "").replace(",", ".");
  const amount = Math.round(Number(normalized));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const isSell = /\b(sat|satış|satayım|satmak istiyorum)\b/i.test(text);
  const isBuy = /\b(al|alış|ekle|alayım|almak istiyorum)\b/i.test(text);
  if (isSell === isBuy) return undefined;
  const lower = text.toLocaleLowerCase("tr-TR");
  const matches = portfolio.holdings.filter((h) => lower.includes(h.name.toLocaleLowerCase("tr-TR")));
  if (matches.length !== 1) return undefined;
  const holding = matches[0];
  return { kind: isSell ? "satis" : "alis", holdingId: holding.id, holdingName: holding.name, amount };
}

export function comparePerformance(portfolio: Portfolio, text: string): string | undefined {
  if (!/en (çok|fazla|iyi|kötü|başarılı)|hangi varlığım (kâr|zarar)/i.test(text)) return undefined;
  if (!portfolio.holdings.length) return "Henüz varlığın yok — Panel sekmesinden ekleyince kıyaslayabilirim.";
  const ranked = portfolio.holdings.map((h) => ({ h, pnl: pnl(h.amount, h.costBasis) }));
  const best = [...ranked].sort((a, b) => b.pnl.pct - a.pnl.pct)[0];
  const worst = [...ranked].sort((a, b) => a.pnl.pct - b.pnl.pct)[0];
  if (/kötü|kaybet|zarar/i.test(text)) return `En geride kalan varlığın: ${worst.h.name} — ${fmtPct(worst.pnl.pct)} (${fmtSignedTL(worst.pnl.abs)}).`;
  if (/iyi|kazan|başarılı/i.test(text)) return `En iyi performans: ${best.h.name} — ${fmtPct(best.pnl.pct)} (${fmtSignedTL(best.pnl.abs)}).`;
  return `En iyi: ${best.h.name} (${fmtPct(best.pnl.pct)}) · En geride: ${worst.h.name} (${fmtPct(worst.pnl.pct)}).`;
}

export function holdingLookupReply(portfolio: Portfolio, text: string): string | undefined {
  const query = text
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/nasıl|gidiyor|durumu|ne\s*kadar|\?/gi, "")
    .trim();
  if (query.length < 2) return undefined;
  const matches = portfolio.holdings.filter((h) => h.name.toLocaleLowerCase("tr-TR").includes(query));
  if (matches.length === 0) return undefined;
  return matches
    .map((h) => {
      const { abs, pct } = pnl(h.amount, h.costBasis);
      return `${h.name} (${TYPE_LABELS[h.type]}): güncel değer ${fmtTL(h.amount)}, maliyet ${fmtTL(h.costBasis)} — ${abs >= 0 ? "kârda" : "zararda"}, ${fmtSignedTL(abs)} (${fmtPct(pct)}).`;
    })
    .join("\n");
}

interface ChatRule {
  id?: string;
  test: RegExp;
  reply: (portfolio: Portfolio) => string;
}

const CHAT_RULES: ChatRule[] = [
  { test: /teşekkür|sağ ?ol|eyvallah|süper|harika/i, reply: () => "Rica ederim! Başka bir sorun olursa buradayım." },
  {
    test: /görüşürüz|hoşça kal|bay ?bay|kapat/i,
    reply: () => "Görüşmek üzere! Portföyünle ilgili aklına bir şey gelirse yine buradayım.",
  },
  {
    test: /merhaba|selam|naber|nasılsın/i,
    reply: () =>
      'Merhaba! Portföyün hakkında soru sorabilir, "analiz et" yazabilir ya da "dağılımımı çiz" gibi bir istekle grafik çizmemi isteyebilirsin.',
  },
  {
    test: /yardım|ne yapabilirsin|neler yapabilirsin|komutlar|nasıl kullan/i,
    reply: () =>
      [
        "Şunları yapabilirim:",
        '• "analiz et" — portföyünün genel değerlendirmesi',
        '• "dağılımım nasıl" — sınıf bazlı ağırlıklar',
        '• "THYAO nasıl gidiyor" gibi varlık bazlı sorular',
        `• "THYAO'dan 500 TL sat" gibi bir komutla gerçek işlem önerebilirim — onaylarsan uygularım`,
        '• "en çok kazandıran ne" / "en çok kaybettiren ne" — kıyaslama',
        '• "dağılımımı çiz" ya da "yatırım grafiğimi göster" — sohbet içinde grafik çizerim',
        "• enflasyon, faiz, altın, risk, projeksiyon gibi genel konular",
        '• "beni ne hatırlıyorsun" — zamanla hangi konularla ilgilendiğini öğrenirim (yalnızca tarayıcında saklanır)',
        '• "Ajanı Eğit" panelinden bana yeni soru-cevaplar öğretebilirsin — öğrettiğin bilgi her zaman diğer cevaplarımdan önce gelir',
        "• her cevabımı 👍/👎 ile oylayabilirsin — 👎 dersen doğrusunu öğretmen için soru-cevap formu otomatik açılır",
      ].join("\n"),
  },
  { id: "analiz", test: /analiz|değerlendir|yorumla/i, reply: (p) => buildAnalysis(p).join("\n\n") },
  {
    test: /toplam|ne kadar param|portföy değer/i,
    reply: (p) => `Portföyünün güncel toplamı ${fmtTL(totalValue(p))} (${p.holdings.length} varlık).`,
  },
  {
    id: "dagilim",
    test: /dağılım|çeşitlendirme|ağırlık/i,
    reply: (p) => {
      const allocation = allocationByType(p);
      return allocation.length
        ? `Sınıf dağılımın:\n` + allocation.map((a) => `• ${TYPE_LABELS[a.type]}: ${fmtTL(a.amount)} (%${a.pct.toFixed(0)})`).join("\n")
        : "Henüz varlık yok; Panel sekmesinden ekleyebilirsin.";
    },
  },
  {
    test: /enflasyon/i,
    reply: () =>
      "Enflasyon dönemlerinde nakitte kalmak reel kayıp demektir; enflasyona dirençli varlıklar (hisse, altın, dövize endeksli araçlar) ile likidite arasında denge kurmak klasik yaklaşımdır.",
  },
  {
    test: /faiz|mevduat/i,
    reply: () =>
      "Mevduat faizi öngörülebilir getiri sağlar ama getirisi enflasyonun altında kalırsa reel kayıp yaşarsın. Faiz getirisini enflasyon beklentisiyle karşılaştırarak değerlendir.",
  },
  {
    test: /\baltın\b/i,
    reply: () =>
      "Altın tarihsel olarak kriz ve enflasyon dönemlerinde koruma sağlar; getirisi dalgalıdır ama portföyde %10-20 bandında tampon görevi görmesi yaygın bir tercih.",
  },
  {
    test: /projeksiyon|gelecek|birikim|hedef/i,
    reply: () =>
      "Projeksiyon sekmesinde aylık katkı ve beklenen yıllık getiriyi ayarlayarak birikiminin yıllara göre nasıl büyüyeceğini görebilirsin. Bileşik getiri en çok süreden beslenir — erken başlamak miktardan değerlidir.",
  },
  {
    id: "risk",
    test: /risk/i,
    reply: (p) => {
      const top = allocationByType(p)[0];
      if (!top) return "Risk değerlendirmesi için önce portföyüne varlık ekle.";
      return top.pct > 50
        ? `Ana riskin konsantrasyon: %${top.pct.toFixed(0)} ağırlıkla ${TYPE_LABELS[top.type]}. Tek sınıfa bağımlılığı azaltmak ilk adım olabilir.`
        : "Portföyün sınıflara dağılmış durumda; ana riskler piyasa geneli (sistematik) risk ve enflasyon. Vade ufkunu netleştirmek risk toleransını belirlemenin en sağlam yolu.";
    },
  },
];

export function memoryQueryReply(memory: AgentMemory | undefined, text: string): string | undefined {
  if (!/beni (ne )?hatırl|hakkımda ne biliyorsun|profilim(i)?( ne)?|hafızan(da)?/i.test(text)) return undefined;
  if (!memory || memory.totalTurns === 0) {
    return "Henüz hakkında bir şey öğrenmedim — birkaç soru sorunca hangi konularla ilgilendiğini fark etmeye başlarım. Bu bilgi yalnızca tarayıcında saklanır, hiçbir yere gönderilmez.";
  }
  const topic = topTopicOf(memory);
  const holding = topHoldingOf(memory);
  const lines = [`Şimdiye kadar ${memory.totalTurns} mesaj konuştuk.`];
  lines.push(
    `Seni şöyle tanıyorum: risk seviyen ${RISK_LABELS[memory.prefs.riskLevel]}, ajan modun ${MODE_LABELS[memory.prefs.agentMode]}, vade tercihin ${VADE_LABELS[memory.prefs.vade]}.`,
  );
  if (memory.prefs.interests.length) lines.push(`İlgi alanların: ${memory.prefs.interests.join(", ")}.`);
  if (topic) lines.push(`En çok "${INTENT_LABELS[topic] ?? topic}" konusunu soruyorsun.`);
  if (holding) lines.push(`En sık bahsettiğin varlık: ${holding}.`);
  if (memory.recentQuestions.length) {
    lines.push(`Son sorularından bazıları: ${memory.recentQuestions.slice(0, 3).map((q) => `"${q}"`).join(", ")}.`);
  }
  lines.push(
    'Tüm bunları "Ajan Ne Biliyor?" panelinde görüp düzenleyebilirsin. Bu bilgi yalnızca tarayıcında saklanır, hiçbir sunucuya gönderilmez — "SIFIRLA" ile bunu da silebilirsin.',
  );
  return lines.join(" ");
}

function topTopicOf(memory: AgentMemory): string | undefined {
  const entries = Object.entries(memory.topicCounts);
  if (entries.length) return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function topHoldingOf(memory: AgentMemory): string | undefined {
  const entries = Object.entries(memory.holdingMentions);
  if (entries.length) return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function buildGreeting(memory: AgentMemory | undefined): string {
  const intro =
    'Merhaba! Ben FAGENT demo ajanı — anahtar gerektirmeden çalışırım. "Analiz Et" butonuna basabilir, portföyün hakkında soru sorabilir ya da "dağılımımı çiz" gibi bir istekle senin için grafik çizmemi isteyebilirsin.';
  if (!memory || memory.totalTurns < 3) return `${intro} "yardım" yazarsan neler yapabildiğimi listelerim.`;
  const topic = topTopicOf(memory);
  const holding = topHoldingOf(memory);
  const lines = ["Tekrar merhaba!"];
  if (topic) lines.push(`Önceki konuşmalarımızda en çok "${INTENT_LABELS[topic] ?? topic}" hakkında konuşmuştuk.`);
  if (holding) lines.push(`${holding} de sık geçen bir konuydu.`);
  lines.push('Kaldığımız yerden devam edebiliriz, ya da "beni ne hatırlıyorsun" yazarak profilini görebilirsin.');
  return lines.join(" ");
}

const FOLLOWUP_REGEX = /^(devam et|biraz daha( anlat)?|detaylandır|peki|başka|daha fazla|derinleş)/i;

function lastAgentIntentId(history: ChatHistoryEntry[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role === "agent" && entry.intentId) return entry.intentId;
  }
  return undefined;
}

export function chatReply(
  portfolio: Portfolio,
  text: string,
  history: ChatHistoryEntry[] = [],
  memory?: AgentMemory,
  trainedFacts: TrainedFact[] = [],
): ChatReplyResult {
  const trimmed = text.trim();
  if (!trimmed) return { text: 'Bir şey yazmadın — bir soru sorabilir ya da "yardım" yazabilirsin.' };

  const trained = findBestMatch(trainedFacts, trimmed);
  if (trained) return { text: trained.answer, intentId: "trained", trainedFactId: trained.id };

  const trade = detectTradeIntent(portfolio, trimmed);
  if (trade) {
    const verb = trade.kind === "alis" ? "almak" : "satmak";
    return { text: `${trade.holdingName} için ${fmtTL(trade.amount)} ${verb} istediğini anladım. Onaylıyor musun?`, pendingAction: trade };
  }

  const memoryReply = memoryQueryReply(memory, trimmed);
  if (memoryReply) return { text: memoryReply };

  if (FOLLOWUP_REGEX.test(trimmed)) {
    const lastIntent = lastAgentIntentId(history);
    if (lastIntent === "analiz") return { text: buildAnalysis(portfolio).join("\n\n"), intentId: "analiz" };
    if (lastIntent === "grafik-dagilim" || lastIntent === "grafik-yatirim" || lastIntent === "grafik-pnl") {
      const chart =
        lastIntent === "grafik-dagilim" ? allocationChart(portfolio) : lastIntent === "grafik-yatirim" ? investmentHistoryChart(portfolio) : pnlBarChart(portfolio);
      if (chart) return { text: `${chart.title} grafiğini büyütüyorum:`, chart, intentId: lastIntent };
    }
    return { text: 'Hangi konuda devam edeyim? "analiz", "dağılım", "risk" ya da bir varlık adı yazabilirsin.', isFallback: true };
  }

  const chartRequest = detectChartRequest(portfolio, trimmed);
  if (chartRequest) return { text: `İşte "${chartRequest.chart.title}" grafiğin:`, chart: chartRequest.chart, intentId: chartRequest.intentId };

  const comparison = comparePerformance(portfolio, trimmed);
  if (comparison) return { text: comparison };

  for (const rule of CHAT_RULES) {
    if (rule.test.test(trimmed)) return { text: rule.reply(portfolio), intentId: rule.id };
  }

  const lookup = holdingLookupReply(portfolio, trimmed);
  if (lookup) return { text: lookup };

  return {
    text:
      'Bunu tam olarak anlayamadım. "analiz et", "dağılımım nasıl", "en çok kazandıran ne", bir varlık adı (ör. "THYAO nasıl gidiyor") ya da "dağılımımı çiz" gibi bir grafik isteği deneyebilirsin. "yardım" yazarsan tüm yeteneklerimi listelerim.',
    isFallback: true,
  };
}
