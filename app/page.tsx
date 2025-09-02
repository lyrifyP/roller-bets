"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from 'next/link';

// -------- Types --------
type Sport = "Football" | "Cricket" | "Tennis" | "Other";
type BetStatus = "Pending" | "Won" | "Lost";

type FootballCategory = "Goals" | "Corners" | "Result" | "Double Chance" | "Other";
type FootballCategoryKey = FootballCategory | "Uncategorised";

type Bet = {
  id: string;
  date: string; // yyyy-mm-dd
  description: string;
  sport: Sport;
  category?: FootballCategory;
  stake: number; // GBP
  oddsDecimal: number;
  status: BetStatus;
  returnOverride?: number; // allows cash out or manual value
  settledAt?: string; // ISO timestamp when status was set from Pending
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

type AppState = {
  targetProfit: number;
  startingBankroll?: number;
  theme: "dark" | "light";
};

// -------- Utilities --------
const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const percentFmt = new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 });

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseNum(n: unknown, fallback = 0) {
  const x = typeof n === "string" ? n.trim() : n;
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function isSettled(s: BetStatus) { return s === "Won" || s === "Lost"; }

function defaultReturn(bet: Bet): number | null {
  if (bet.status === "Won") return +(bet.stake * bet.oddsDecimal).toFixed(2);
  if (bet.status === "Lost") return 0;
  return null;
}

function effectiveReturn(bet: Bet): number | null {
  if (isSettled(bet.status)) {
    if (bet.returnOverride !== undefined && bet.returnOverride !== null) {
      return +bet.returnOverride.toFixed(2);
    }
    return defaultReturn(bet);
  }
  return null;
}

function toISODateInput(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

// Simple SVG line renderer for cumulative profit
function LineChart({ points, height = 180 }: { points: { x: number; y: number; label: string }[], height?: number }) {
  const padding = 16;
  const width = 720; // viewBox width, scales to container
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  if (!points.length) {
    return (
      <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">No data yet</div>
    );
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const spanY = Math.max(1, maxY - minY);

  const pathD = points.map((p, i) => {
    const x = padding + (innerW * (p.x - xs[0])) / Math.max(1, xs[xs.length - 1] - xs[0]);
    const y = padding + innerH - ((p.y - minY) / spanY) * innerH;
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");

  // axis lines
  const zeroY = padding + innerH - ((0 - minY) / spanY) * innerH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]">
      {/* background grid */}
      <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="currentColor" opacity={0.2} />
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2} />
      {/* end dot */}
      {(() => {
        const last = points[points.length - 1];
        const x = padding + (innerW * (last.x - xs[0])) / Math.max(1, xs[xs.length - 1] - xs[0]);
        const y = padding + innerH - ((last.y - minY) / spanY) * innerH;
        return <circle cx={x} cy={y} r={3} fill="currentColor" />;
      })()}
    </svg>
  );
}

// -------- Main Component --------
export default function RollerBetsTracker() {
  // App state
  const [state, setState] = useState<AppState>({ targetProfit: 100, startingBankroll: 5, theme: "dark" });
  const [bets, setBets] = useState<Bet[]>([]);
  const [isClient, setIsClient] = useState(false);

  // Initialize client-side data
  useEffect(() => {
    setIsClient(true);
    
    // Load state from localStorage
    const rawState = localStorage.getItem("rb.state");
    if (rawState) {
      try { 
        const parsedState = JSON.parse(rawState) as AppState;
        setState(parsedState);
      } catch {}
    }
    
    // Load bets from localStorage
    const rawBets = localStorage.getItem("rb.bets");
    if (rawBets) {
      try { 
        const parsedBets = JSON.parse(rawBets) as Bet[];
        setBets(parsedBets);
      } catch {}
    } else {
      // seed two examples on first run
      setBets([
        { id: uid(), date: toISODateInput(), description: "Chelsea BTTS", sport: "Football", stake: 5, oddsDecimal: 1.53, status: "Lost", returnOverride: 0, settledAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: uid(), date: toISODateInput(), description: "ATP match winner", sport: "Tennis", stake: 10, oddsDecimal: 2.1, status: "Pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);
    }
  }, []);

  const [lastDeleted, setLastDeleted] = useState<Bet | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => { 
    if (isClient) {
      localStorage.setItem("rb.bets", JSON.stringify(bets)); 
    }
  }, [bets, isClient]);
  useEffect(() => { 
    if (isClient) {
      localStorage.setItem("rb.state", JSON.stringify(state)); 
      document.documentElement.classList.toggle("dark", state.theme === "dark"); 
    }
  }, [state, isClient]);
  

  // Derived metrics
  const totals = useMemo(() => {
    const settled = bets.filter(b => isSettled(b.status));
    const totalStaked = +bets.reduce((s, b) => s + b.stake, 0).toFixed(2);
    const totalReturned = +settled.reduce((s, b) => s + (effectiveReturn(b) ?? 0), 0).toFixed(2);
    const profit = +(totalReturned - settled.reduce((s, b) => s + b.stake, 0)).toFixed(2);
    const winRate = settled.length ? (settled.filter(b => b.status === "Won").length / settled.length) : 0;
    const progress = state.targetProfit > 0 ? clamp01(profit / state.targetProfit) : 0;
    return { totalStaked, totalReturned, profit, winRate, progress };
  }, [bets, state.targetProfit]);

  // Cumulative profit series, by date
  const cumulative = useMemo(() => {
    const settled = bets.filter(b => isSettled(b.status)).slice().sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const points: { date: string; value: number }[] = [];    for (const b of settled) {
      const ret = effectiveReturn(b) ?? 0;
      running += ret - b.stake;      points.push({ date: b.date, value: +running.toFixed(2) });
    }
    // also push zero at the start so the line begins at zero
    if (points.length) points.unshift({ date: points[0].date, value: 0 });
    return points;
  }, [bets]);

  const chartPoints = useMemo(() => {
    return cumulative.map((p, i) => ({ x: i, y: p.value, label: p.date }));
  }, [cumulative]);

  // -------- Add form --------
  const [form, setForm] = useState<{ date: string; description: string; sport: Sport; category?: FootballCategory; stake: string; oddsDecimal: string; status: BetStatus; returnOverride?: string }>({
    date: toISODateInput(), description: "", sport: "Football", category: "Result", stake: "5", oddsDecimal: "1.50", status: "Pending",
  });

  const addDisabled = !form.description.trim() || parseNum(form.stake) <= 0 || parseNum(form.oddsDecimal) <= 1;

  function addBet() {
    if (addDisabled) return;
    const now = new Date().toISOString();
    const bet: Bet = {
      id: uid(),
      date: form.date,
      description: form.description.trim(),
      sport: form.sport,
      category: form.sport === "Football" ? form.category : undefined,
      stake: +parseNum(form.stake).toFixed(2),
      oddsDecimal: +parseNum(form.oddsDecimal).toFixed(3),
      status: form.status,
      returnOverride: form.returnOverride !== undefined && form.returnOverride !== "" ? +parseNum(form.returnOverride).toFixed(2) : undefined,
      settledAt: isSettled(form.status) ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
    setBets(b => [bet, ...b]);
    setForm(f => ({ ...f, description: "", stake: f.stake, oddsDecimal: f.oddsDecimal, status: "Pending" }));
  }

  // -------- Filters --------
  const [filter, setFilter] = useState<{ sport: Sport | "All"; status: BetStatus | "All"; from?: string; to?: string }>({
    sport: "All", status: "All",
  });

  // URL sync for filters
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Hydrate filters from URL on mount and when URL changes (e.g., back/forward)
  useEffect(() => {
    if (!isClient) return;
    const qsStatus = searchParams.get("status");
    const qsSport = searchParams.get("sport");
    const qsFrom = searchParams.get("from");
    const qsTo = searchParams.get("to");

    const next: { sport: Sport | "All"; status: BetStatus | "All"; from?: string; to?: string } = {
      sport: (qsSport === "Football" || qsSport === "Cricket" || qsSport === "Tennis" || qsSport === "Other") ? qsSport : (qsSport === "All" ? "All" : filter.sport),
      status: (qsStatus === "Pending" || qsStatus === "Won" || qsStatus === "Lost" || qsStatus === "All") ? qsStatus as BetStatus | "All" : filter.status,
      from: qsFrom || undefined,
      to: qsTo || undefined,
    };
    // Only update if different
    if (next.sport !== filter.sport || next.status !== filter.status || next.from !== filter.from || next.to !== filter.to) {
      setFilter(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, searchParams]);

  // Write filters to URL (replace) when they change
  useEffect(() => {
    if (!isClient) return;
    const params = new URLSearchParams(searchParams.toString());
    // Apply or delete params based on defaults
    if (filter.status && filter.status !== "All") params.set("status", filter.status);
    else params.delete("status");

    if (filter.sport && filter.sport !== "All") params.set("sport", filter.sport);
    else params.delete("sport");

    if (filter.from) params.set("from", filter.from); else params.delete("from");
    if (filter.to) params.set("to", filter.to); else params.delete("to");

    const newQs = params.toString();
    const url = newQs ? `${pathname}?${newQs}` : pathname;
    router.replace(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, isClient]);

  const filteredBets = bets.filter(b => {
    if (filter.sport !== "All" && b.sport !== filter.sport) return false;
    if (filter.status !== "All" && b.status !== filter.status) return false;
    if (filter.from && b.date < filter.from) return false;
    if (filter.to && b.date > filter.to) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  const footballCategoryStats = useMemo(() => {
    const fb = filteredBets.filter(b => b.sport === "Football");
    type Stat = { bets: number; settled: number; stakedSettled: number; returned: number; wins: number };
    const map = new Map<FootballCategoryKey, Stat>();
    for (const b of fb) {
      const key = (b.category ?? "Uncategorised") as FootballCategoryKey;
      const cur = map.get(key) ?? { bets: 0, settled: 0, stakedSettled: 0, returned: 0, wins: 0 };
      cur.bets += 1;
      if (isSettled(b.status)) {
        cur.settled += 1;
        cur.stakedSettled += b.stake;
        cur.returned += effectiveReturn(b) ?? 0;
        if (b.status === "Won") cur.wins += 1;
      }
      map.set(key, cur);
    }
    const rows = Array.from(map.entries()).map(([category, m]) => {
      const profit = +(m.returned - m.stakedSettled).toFixed(2);
      const roi = m.stakedSettled > 0 ? profit / m.stakedSettled : 0;
      const winRate = m.settled > 0 ? m.wins / m.settled : 0;
      return { category, bets: m.bets, settled: m.settled, staked: +m.stakedSettled.toFixed(2), returned: +m.returned.toFixed(2), profit, roi, winRate };
    }).sort((a, b) => b.profit - a.profit);
    return rows;
  }, [filteredBets]);

  // -------- Editing --------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<{ stake: string; oddsDecimal: string; status: BetStatus; category?: FootballCategory; returnOverride?: string }>({ stake: "", oddsDecimal: "", status: "Pending" });

  function beginEdit(bet: Bet) {
    setEditingId(bet.id);
    setEditVals({ stake: String(bet.stake), oddsDecimal: String(bet.oddsDecimal), status: bet.status, category: bet.category, returnOverride: bet.returnOverride !== undefined ? String(bet.returnOverride) : undefined });
  }

  function saveEdit(id: string) {
    setBets(list => list.map(b => {
      if (b.id !== id) return b;
      const now = new Date().toISOString();
      const nextStatus = editVals.status;
      return {
        ...b,
        stake: +parseNum(editVals.stake).toFixed(2),
        oddsDecimal: +parseNum(editVals.oddsDecimal).toFixed(3),
        status: nextStatus,
        category: b.sport === "Football" ? editVals.category : undefined,
        returnOverride: editVals.returnOverride !== undefined && editVals.returnOverride !== "" ? +parseNum(editVals.returnOverride).toFixed(2) : undefined,
        settledAt: isSettled(b.status) || isSettled(nextStatus) ? now : undefined,
        updatedAt: now,
      };
    }));
    setEditingId(null);
  }

  function deleteBet(id: string) {
    const toDelete = bets.find(b => b.id === id) || null;
    setBets(list => list.filter(b => b.id !== id));
    setLastDeleted(toDelete);
    if (undoTimer.current && isClient) window.clearTimeout(undoTimer.current);
    if (isClient) {
      undoTimer.current = window.setTimeout(() => setLastDeleted(null), 10000);
    }
  }

  function undoDelete() {
    if (!lastDeleted) return;
    setBets(list => [lastDeleted, ...list]);
    setLastDeleted(null);
    if (undoTimer.current && isClient) window.clearTimeout(undoTimer.current);
  }

  function copySummary() {
    const lines = [
      "Roller Bets summary",
      `Total staked: ${currency.format(totals.totalStaked)}`,
      `Total returned: ${currency.format(totals.totalReturned)}`,
      `Profit: ${currency.format(totals.profit)}`,
      `Win rate: ${percentFmt.format(totals.winRate)}`,
      `Goal progress: ${percentFmt.format(totals.progress)} (${currency.format(totals.totalReturned)} of ${currency.format(state.targetProfit)})`,
      "",
      "Recent bets:",
      ...bets.slice(0, 3).map(b => `${b.date} ${b.description} ${b.sport} Stake ${currency.format(b.stake)} Odds ${b.oddsDecimal.toFixed(2)} Status ${b.status} Return ${effectiveReturn(b) == null ? "N/A" : currency.format(effectiveReturn(b) as number)}`)
    ];
    const text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setToast("Summary copied to clipboard"))
        .catch(() => setToast("Copy failed, select and copy manually"));
      window.setTimeout(() => setToast(null), 2000);
    } else {
      setToast("Copy not supported, select and copy manually");
      window.setTimeout(() => setToast(null), 2000);
    }
  }

  // Layout helpers
  const card = "rounded-2xl p-4 bg-slate-900/60 border border-slate-800 shadow-lg";
  const input = "w-full rounded-xl bg-slate-900/50 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const select = input;
  const btn = "rounded-xl px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50";
  const btnGhost = "rounded-xl px-3 py-2 text-sm font-medium bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700";

  return (
    <div className={state.theme === "dark" ? "min-h-screen bg-slate-950 text-slate-100" : "min-h-screen bg-slate-50 text-slate-900"}>
      {!isClient ? (
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-center py-12">
            <div className="text-lg">Loading...</div>
          </div>
        </div>
      ) : (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Roller Bets Tracker</h1>
            <p className="text-xs sm:text-sm opacity-70">Local only, fast entry, clean stats.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none inline-flex rounded-xl border border-slate-700 overflow-hidden">
              {(["All","Pending","Won","Lost"]).map((s) => (
                <button key={s} type="button" className={`flex-1 sm:flex-none px-2 sm:px-3 py-2 text-xs sm:text-sm ${filter.status === s ? "bg-slate-700" : "bg-slate-800/60 hover:bg-slate-700/60"}`} onClick={() => setFilter(f => ({ ...f, status: s as BetStatus | "All" }))}>
                  {s}
                </button>
              ))}
            </div>
            <Link href="/insights" className={btnGhost + " text-xs sm:text-sm"}>
  Insights </Link>
            <button className={btnGhost + " text-xs sm:text-sm"} type="button" onClick={copySummary}>Copy</button>
          </div>
        </div>

        {/* Add form, mobile first on top */}
        <div className={card}>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
            <div className="col-span-2 md:col-span-2">
              <label className="text-xs opacity-80">Date</label>
              <input className={input} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className="text-xs opacity-80">Bet</label>
              <input className={input} placeholder="Villa race to 9 corners" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-xs opacity-80">Sport</label>
              <select className={select} value={form.sport} onChange={e => setForm(f => ({ ...f, sport: e.target.value as Sport }))}>
                {(["Football", "Cricket", "Tennis", "Other"] as Sport[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {form.sport === "Football" && (
              <div className="col-span-1 md:col-span-2">
                <label className="text-xs opacity-80">Category</label>
                <select className={select} value={form.category ?? "Result"} onChange={e => setForm(f => ({ ...f, category: e.target.value as FootballCategory }))}>
                  {(["Result","Double Chance","Goals","Corners","Other"] as FootballCategory[]).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-1 md:col-span-1">
              <label className="text-xs opacity-80">Stake</label>
              <input className={input} type="number" step="0.01" min="0" value={form.stake} onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} />
            </div>
            <div className="col-span-1 md:col-span-1">
              <label className="text-xs opacity-80">Odds</label>
              <input className={input} type="number" step="0.01" min="1.01" value={form.oddsDecimal} onChange={e => setForm(f => ({ ...f, oddsDecimal: e.target.value }))} />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-xs opacity-80">Status</label>
              <select className={select} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as BetStatus }))}>
                {(["Pending", "Won", "Lost"] as BetStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {(form.status === "Won" || form.status === "Lost") && (
              <div className="col-span-2 md:col-span-2">
                <label className="text-xs opacity-80">Return override (£)</label>
                <input className={input} type="number" step="0.01" min="0" value={form.returnOverride ?? ""} onChange={e => setForm(f => ({ ...f, returnOverride: e.target.value }))} placeholder="optional" />
              </div>
            )}

            <div className="col-span-2 md:col-span-1 flex justify-end">
              <button className={btn + " w-full md:w-auto"} disabled={addDisabled} onClick={addBet}>Add</button>
            </div>
          </div>
        </div>

        {/* Goal and bankroll */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={card}>
            <div className="text-xs opacity-80 mb-1">Target Profit (£)</div>
            <input className={input} type="number" step="1" min="1" value={state.targetProfit} onChange={e => setState(s => ({ ...s, targetProfit: Math.max(1, parseNum(e.target.value, 100)) }))} />
            <p className="text-xs mt-2 opacity-70">Progress tracks net profit. Adjust this to set your goal.</p>
          </div>
          <div className={card}>
            <div className="text-xs opacity-80 mb-1">Starting Bankroll (£)</div>
            <input className={input} type="number" step="1" min="0" value={state.startingBankroll ?? ""} onChange={e => setState(s => ({ ...s, startingBankroll: parseNum(e.target.value, 0) }))} />
            <p className="text-xs mt-2 opacity-70">Optional, for context in stats.</p>
          </div>
          <div className={card}>
            <div className="flex items-center justify-between text-xs opacity-80 mb-2"><span>Goal Progress</span><span>{percentFmt.format(totals.progress)}</span></div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${totals.progress * 100}%` }} />
            </div>
            <div className="text-sm mt-2 opacity-80">{currency.format(Math.max(0, totals.profit))} of {currency.format(state.targetProfit)}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className={card}><div className="text-xs opacity-80">Total Staked</div><div className="text-lg sm:text-2xl font-semibold">{currency.format(totals.totalStaked)}</div></div>
          <div className={card}><div className="text-xs opacity-80">Total Returned</div><div className="text-lg sm:text-2xl font-semibold">{currency.format(totals.totalReturned)}</div></div>
          <div className={card}><div className="text-xs opacity-80">Profit</div><div className={"text-lg sm:text-2xl font-semibold " + (totals.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{currency.format(totals.profit)}</div></div>
          <div className={card}><div className="text-xs opacity-80">Win Rate</div><div className="text-lg sm:text-2xl font-semibold">{percentFmt.format(totals.winRate)}</div></div>
        </div>

        {/* Chart */}
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm opacity-80">Cumulative profit</div>
            <div className="text-xs opacity-60">by settled date</div>
          </div>
          <div className="text-indigo-400">
            <LineChart points={chartPoints} />
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm opacity-80">Football categories performance</div>
            <div className="text-xs opacity-60">based on current filters</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-300 border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Bets</th>
                  <th className="py-2 pr-3">Settled</th>
                  <th className="py-2 pr-3">Staked</th>
                  <th className="py-2 pr-3">Returned</th>
                  <th className="py-2 pr-3">Profit</th>
                  <th className="py-2 pr-3">ROI</th>
                  <th className="py-2 pr-3">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {footballCategoryStats.length === 0 ? (
                  <tr><td colSpan={8} className="py-4 text-center text-slate-400">No football bets yet</td></tr>
                ) : footballCategoryStats.map(row => (
                  <tr key={row.category as string} className="border-b border-slate-800/80">
                    <td className="py-2 pr-3">{row.category}</td>
                    <td className="py-2 pr-3">{row.bets}</td>
                    <td className="py-2 pr-3">{row.settled}</td>
                    <td className="py-2 pr-3">{currency.format(row.staked)}</td>
                    <td className="py-2 pr-3">{currency.format(row.returned)}</td>
                    <td className={"py-2 pr-3 " + (row.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{currency.format(row.profit)}</td>
                    <td className="py-2 pr-3">{percentFmt.format(row.roi)}</td>
                    <td className="py-2 pr-3">{percentFmt.format(row.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Filters */}
        <div className={card}>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="col-span-1 md:col-span-1">
              <label className="text-xs opacity-80">Status</label>
              <select className={select} value={filter.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(f => ({ ...f, status: e.target.value as BetStatus | "All" }))}>
                <option>All</option>
                <option>Pending</option>
                <option>Won</option>
                <option>Lost</option>
              </select>
            </div>
            <div className="col-span-1 md:col-span-1">
              <label className="text-xs opacity-80">Sport</label>
              <select className={select} value={filter.sport} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(f => ({ ...f, sport: e.target.value as Sport | "All" }))}>
                <option>All</option>
                <option>Football</option>
                <option>Cricket</option>
                <option>Tennis</option>
                <option>Other</option>
              </select>
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-xs opacity-80">From</label>
              <input className={input} type="date" value={filter.from ?? ""} onChange={e => setFilter(f => ({ ...f, from: e.target.value || undefined }))} />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-xs opacity-80">To</label>
              <input className={input} type="date" value={filter.to ?? ""} onChange={e => setFilter(f => ({ ...f, to: e.target.value || undefined }))} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className={card}>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[800px] sm:min-w-0">
              <table className="w-full text-xs sm:text-sm">
              <thead className="text-left text-slate-300 border-b border-slate-800 sticky top-0 bg-slate-900/60">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Bet</th>
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Stake</th>
                  <th className="py-2 pr-3">Odds</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Return</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBets.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-slate-400">No bets match your filter</td></tr>
                )}
                {filteredBets.map(bet => {
                  const isEditing = editingId === bet.id;
                  const ret = effectiveReturn(bet);
                  return (
                    <tr key={bet.id} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3 align-top whitespace-nowrap">{bet.date}</td>
                      <td className="py-2 pr-3 align-top min-w-[240px]">{bet.description}</td>
                      <td className="py-2 pr-3 align-top">{bet.sport}</td>
                      <td className="py-2 pr-3 align-top">
                        {isEditing && bet.sport === "Football" ? (
                          <select className={select} value={editVals.category ?? "Result"} onChange={e => setEditVals(v => ({ ...v, category: e.target.value as FootballCategory }))}>
                            {(["Result","Double Chance","Goals","Corners","Other"] as FootballCategory[]).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          bet.sport === "Football" ? (bet.category ?? "Uncategorised") : "N/A"
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {isEditing ? (
                          <input className={input} type="number" step="0.01" min="0" value={editVals.stake} onChange={e => setEditVals(v => ({ ...v, stake: e.target.value }))} />
                        ) : currency.format(bet.stake)}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {isEditing ? (
                          <input className={input} type="number" step="0.01" min="1.01" value={editVals.oddsDecimal} onChange={e => setEditVals(v => ({ ...v, oddsDecimal: e.target.value }))} />
                        ) : bet.oddsDecimal.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {isEditing ? (
                          <select className={select} value={editVals.status} onChange={e => setEditVals(v => ({ ...v, status: e.target.value as BetStatus }))}>
                            <option>Pending</option>
                            <option>Won</option>
                            <option>Lost</option>
                          </select>
                        ) : (
                          <span className={
                            "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium " +
                            (bet.status === "Pending" ? "bg-slate-700/70" : bet.status === "Won" ? "bg-emerald-600/70" : "bg-rose-600/70")
                          }>
                            {bet.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {isEditing ? (
                          <input className={input} type="number" step="0.01" min="0" value={editVals.returnOverride ?? ""} onChange={e => setEditVals(v => ({ ...v, returnOverride: e.target.value }))} placeholder={defaultReturn({ ...bet, status: editVals.status })?.toString() ?? ""} />
                        ) : (
                          ret === null ? "N/A" : currency.format(ret)
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <button className={btn} onClick={() => saveEdit(bet.id)}>Save</button>
                            <button className={btnGhost} onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-end">
                            <button className={btnGhost} onClick={() => beginEdit(bet)}>Edit</button>
                            <button className="rounded-xl px-3 py-2 text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white" onClick={() => deleteBet(bet.id)}>Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        {lastDeleted && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 text-slate-100 border border-slate-700 rounded-xl px-4 py-3 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="text-sm">Bet deleted</span>
              <button className={btnGhost} onClick={undoDelete}>Undo</button>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 text-slate-100 border border-slate-700 rounded-xl px-4 py-3 shadow-lg">
            <span className="text-sm">{toast}</span>
          </div>
        )}

        <footer className="text-center text-xs opacity-60 pt-4 pb-2">Made for quick rollers. Data is saved only in your browser.</footer>
      </div>
      )}
    </div>
  );
}
