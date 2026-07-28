import { useSyncExternalStore } from "react";

export type AssetType = "hisse" | "fon" | "doviz" | "altin" | "kripto" | "mevduat";

export const TYPE_LABELS: Record<AssetType, string> = {
  hisse: "Hisse",
  fon: "Fon",
  doviz: "Döviz",
  altin: "Altın",
  kripto: "Kripto",
  mevduat: "Mevduat",
};

export interface Holding {
  id: string;
  name: string;
  type: AssetType;
  amount: number;
  costBasis: number;
  quantity?: number;
  symbol?: string;
  lastFetchedAt?: string;
}

export type TxnKind = "alis" | "satis";

export interface Txn {
  id: string;
  date: string;
  holdingId: string;
  holdingName: string;
  kind: TxnKind;
  amount: number;
  commission?: number;
}

export interface Portfolio {
  onboarded: boolean;
  holdings: Holding[];
  txns: Txn[];
  realizedPnl: number;
}

const STORAGE_KEY = "fagent.lab.portfolio.v1";

const EMPTY_PORTFOLIO: Portfolio = {
  onboarded: false,
  holdings: [],
  txns: [],
  realizedPnl: 0,
};

function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayISO(): string {
  return formatDateISO(new Date());
}

function dateOffsetISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDateISO(d);
}

const SAMPLE_MIXED: Portfolio = {
  onboarded: true,
  realizedPnl: 0,
  holdings: [
    { id: "h1", name: "BIST 30 Fonu", type: "fon", amount: 48500, costBasis: 45000 },
    { id: "h2", name: "THYAO", type: "hisse", amount: 25200, costBasis: 28000 },
    { id: "h3", name: "Gram Altın", type: "altin", amount: 23800, costBasis: 22000 },
    { id: "h4", name: "USD", type: "doviz", amount: 15000, costBasis: 15000 },
    { id: "h5", name: "Vadeli Mevduat", type: "mevduat", amount: 31200, costBasis: 30000 },
  ],
  txns: [
    { id: "t1", date: dateOffsetISO(-21), holdingId: "h1", holdingName: "BIST 30 Fonu", kind: "alis", amount: 15000 },
    { id: "t2", date: dateOffsetISO(-14), holdingId: "h2", holdingName: "THYAO", kind: "alis", amount: 8000 },
    { id: "t3", date: dateOffsetISO(-7), holdingId: "h3", holdingName: "Gram Altın", kind: "alis", amount: 6000 },
    { id: "t4", date: dateOffsetISO(-2), holdingId: "h4", holdingName: "USD", kind: "satis", amount: 3000 },
  ],
};

const SAMPLE_CRYPTO: Portfolio = {
  onboarded: true,
  realizedPnl: 0,
  holdings: [
    { id: "c1", name: "Bitcoin", type: "kripto", amount: 42500, costBasis: 35000, quantity: 0.01, symbol: "bitcoin" },
    { id: "c2", name: "Ethereum", type: "kripto", amount: 42000, costBasis: 48000, quantity: 0.3, symbol: "ethereum" },
    { id: "c3", name: "Solana", type: "kripto", amount: 50000, costBasis: 40000, quantity: 25, symbol: "solana" },
    { id: "c4", name: "Tether", type: "kripto", amount: 42000, costBasis: 42000, quantity: 1000, symbol: "tether" },
  ],
  txns: [
    { id: "ct1", date: dateOffsetISO(-30), holdingId: "c1", holdingName: "Bitcoin", kind: "alis", amount: 35000 },
    { id: "ct2", date: dateOffsetISO(-21), holdingId: "c2", holdingName: "Ethereum", kind: "alis", amount: 48000 },
    { id: "ct3", date: dateOffsetISO(-14), holdingId: "c4", holdingName: "Tether", kind: "alis", amount: 42000 },
    { id: "ct4", date: dateOffsetISO(-7), holdingId: "c3", holdingName: "Solana", kind: "alis", amount: 40000 },
  ],
};

function loadState(): Portfolio {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PORTFOLIO;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.holdings) || !Array.isArray(parsed.txns)) return EMPTY_PORTFOLIO;
    const holdings: Holding[] = parsed.holdings.map((h: any) => ({
      ...h,
      costBasis: typeof h.costBasis === "number" ? h.costBasis : h.amount,
    }));
    const txns: Txn[] = parsed.txns.map((t: any) => ({
      ...t,
      holdingId:
        typeof t.holdingId === "string" && t.holdingId
          ? t.holdingId
          : holdings.find((h) => h.name === t.holdingName)?.id ?? "",
    }));
    const realizedPnl = typeof parsed.realizedPnl === "number" ? parsed.realizedPnl : 0;
    return { ...parsed, holdings, txns, realizedPnl };
  } catch {
    return EMPTY_PORTFOLIO;
  }
}

let state: Portfolio = loadState();
const subscribers = new Set<() => void>();

function setState(next: Portfolio) {
  state = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  subscribers.forEach((fn) => fn());
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("tr-TR");
}

export const actions = {
  startWithSample() {
    setState(structuredClone(SAMPLE_MIXED));
  },
  startWithCryptoSample() {
    setState(structuredClone(SAMPLE_CRYPTO));
  },
  startEmpty() {
    setState({ ...EMPTY_PORTFOLIO, onboarded: true });
  },
  reset() {
    localStorage.removeItem(STORAGE_KEY);
    setState(EMPTY_PORTFOLIO);
  },
  addHolding(name: string, type: AssetType, amount: number, quantity?: number, symbol?: string) {
    const trimmed = name.trim();
    const id = `h${Date.now()}`;
    const holding: Holding = { id, name: trimmed, type, amount, costBasis: amount };
    if (quantity !== undefined && symbol) {
      holding.quantity = quantity;
      holding.symbol = symbol;
      holding.lastFetchedAt = new Date().toISOString();
    }
    const txn: Txn = {
      id: `t${Date.now()}`,
      date: todayISO(),
      holdingId: id,
      holdingName: trimmed,
      kind: "alis",
      amount,
    };
    setState({ ...state, holdings: [...state.holdings, holding], txns: [txn, ...state.txns] });
  },
  holdingNameExists(name: string): boolean {
    const target = normalizeName(name);
    return state.holdings.some((h) => normalizeName(h.name) === target);
  },
  importHoldings(list: { name: string; type: AssetType; amount: number; costBasis: number }[]) {
    const seen = new Set(state.holdings.map((h) => normalizeName(h.name)));
    const toAdd: Holding[] = [];
    let duplicates = 0;
    list.forEach((item, idx) => {
      const key = normalizeName(item.name);
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      toAdd.push({
        id: `h${Date.now()}-${idx}`,
        name: item.name.trim(),
        type: item.type,
        amount: item.amount,
        costBasis: item.costBasis,
      });
    });
    if (toAdd.length > 0) setState({ ...state, holdings: [...state.holdings, ...toAdd] });
    return { imported: toAdd.length, duplicates };
  },
  removeHolding(id: string) {
    setState({ ...state, holdings: state.holdings.filter((h) => h.id !== id) });
  },
  updateHoldingValue(id: string, amount: number) {
    const holdings = state.holdings.map((h) => (h.id === id ? { ...h, amount: Math.max(0, amount) } : h));
    setState({ ...state, holdings });
  },
  applyLivePrice(id: string, amount: number) {
    const holdings = state.holdings.map((h) =>
      h.id === id ? { ...h, amount: Math.max(0, amount), lastFetchedAt: new Date().toISOString() } : h,
    );
    setState({ ...state, holdings });
  },
  addTxn(holdingId: string, kind: TxnKind, amount: number, commission = 0) {
    const holding = state.holdings.find((h) => h.id === holdingId);
    if (!holding) return;
    const fee = Math.max(0, commission);
    const txn: Txn = {
      id: `t${Date.now()}`,
      date: todayISO(),
      holdingId,
      holdingName: holding.name,
      kind,
      amount,
      ...(fee > 0 ? { commission: fee } : {}),
    };
    let realized = 0;
    const holdings = state.holdings.map((h) => {
      if (h.id !== holdingId) return h;
      if (kind === "alis") return { ...h, amount: h.amount + amount, costBasis: h.costBasis + amount + fee };
      const newAmount = Math.max(0, h.amount - amount);
      const remainingRatio = h.amount > 0 ? newAmount / h.amount : 0;
      const realizedCostPortion = h.costBasis * (1 - remainingRatio);
      realized = amount - fee - realizedCostPortion;
      return { ...h, amount: newAmount, costBasis: h.costBasis * remainingRatio };
    });
    setState({ ...state, holdings, txns: [txn, ...state.txns], realizedPnl: state.realizedPnl + realized });
  },
};

export function usePortfolio(): Portfolio {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => state,
  );
}

export function totalValue(portfolio: Portfolio): number {
  return portfolio.holdings.reduce((sum, h) => sum + h.amount, 0);
}

export function totalCost(portfolio: Portfolio): number {
  return portfolio.holdings.reduce((sum, h) => sum + h.costBasis, 0);
}

export function pnl(value: number, cost: number): { abs: number; pct: number } {
  const abs = value - cost;
  const pct = cost > 0 ? (abs / cost) * 100 : 0;
  return { abs, pct };
}

export function netInvestmentHistory(portfolio: Portfolio): { tarih: string; tutar: number }[] {
  const sorted = [...portfolio.txns].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, number>();
  let running = 0;
  for (const t of sorted) {
    running += t.kind === "alis" ? t.amount : -t.amount;
    byDate.set(t.date, Math.max(0, running));
  }
  return [...byDate.entries()].map(([tarih, tutar]) => ({ tarih, tutar }));
}

export const fmtTL = (amount: number): string =>
  amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export const fmtPct = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;

export const fmtSignedTL = (amount: number): string => `${amount >= 0 ? "+" : ""}${fmtTL(amount)}`;
