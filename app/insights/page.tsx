'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// -------- Types --------
type Sport = 'Football' | 'Cricket' | 'Tennis' | 'Other';
type BetStatus = 'Pending' | 'Won' | 'Lost';
type FootballCategory = 'Goals' | 'Corners' | 'Result' | 'Double Chance' | 'Other';
type FootballCategoryKey = FootballCategory | 'Uncategorised';

type Bet = {
  id: string;
  date: string;          // yyyy-mm-dd
  description: string;
  sport: Sport;
  category?: FootballCategory;
  stake: number;         // GBP
  oddsDecimal: number;
  status: BetStatus;
  returnOverride?: number;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
};

type AppState = {
  targetProfit: number;
  startingBankroll?: number;
  theme: 'dark' | 'light';
};

// -------- Utilities --------
const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const percentFmt = new Intl.NumberFormat('en-GB', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function isSettled(s: BetStatus) { return s === 'Won' || s === 'Lost'; }
function defaultReturn(b: Bet): number | null {
  if (b.status === 'Won') return +(b.stake * b.oddsDecimal).toFixed(2);
  if (b.status === 'Lost') return 0;
  return null;
}
function effectiveReturn(b: Bet): number | null {
  if (!isSettled(b.status)) return null;
  if (b.returnOverride !== undefined && b.returnOverride !== null) return +b.returnOverride.toFixed(2);
  return defaultReturn(b);
}
function median(nums: number[]) {
  if (nums.length === 0) return 0;
  const arr = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function endOfMonth(yyyyMm: string) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, m, 0);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function dayName(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
}

// -------- Page wrapper with Suspense --------
export default function InsightsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="text-center py-12"><div className="text-lg">Loading insights…</div></div>
      </div>
    }>
      <InsightsInner />
    </Suspense>
  );
}

// -------- Main content that uses router hooks --------
function InsightsInner() {
  const [isClient, setIsClient] = useState(false);
  const [state, setState] = useState<AppState>({ targetProfit: 100, theme: 'dark' });
  const [bets, setBets] = useState<Bet[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setIsClient(true);
    try {
      const rawState = localStorage.getItem('rb.state');
      if (rawState) setState(JSON.parse(rawState) as AppState);
      const rawBets = localStorage.getItem('rb.bets');
      if (rawBets) setBets(JSON.parse(rawBets) as Bet[]);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isClient) return;
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme, isClient]);

  const card = 'rounded-2xl p-4 bg-slate-900/60 border border-slate-800 shadow-lg';
  const btnGhost = 'rounded-xl px-3 py-2 text-sm font-medium bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700';
  const field = 'w-full rounded-xl bg-slate-900/50 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  // Global filters synced with URL
  const [filter, setFilter] = useState<{ sport: Sport | 'All'; from?: string; to?: string }>({ sport: 'All' });

  // Hydrate filters from query
  useEffect(() => {
    if (!isClient) return;
    const qsSport = searchParams.get('sport');
    const qsFrom = searchParams.get('from');
    const qsTo = searchParams.get('to');
    const next: { sport: Sport | 'All'; from?: string; to?: string } = {
      sport:
        qsSport === 'Football' || qsSport === 'Cricket' || qsSport === 'Tennis' || qsSport === 'Other'
          ? qsSport
          : qsSport === 'All'
          ? 'All'
          : filter.sport,
      from: qsFrom || undefined,
      to: qsTo || undefined,
    };
    if (next.sport !== filter.sport || next.from !== filter.from || next.to !== filter.to) setFilter(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, searchParams]);

  // Write filters to URL
  useEffect(() => {
    if (!isClient) return;
    const params = new URLSearchParams();
    if (filter.sport && filter.sport !== 'All') params.set('sport', filter.sport);
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, isClient, pathname, router]);

  // Apply filters to data source
  const filteredBets = useMemo(() => {
    return bets.filter(b => {
      if (filter.sport !== 'All' && b.sport !== filter.sport) return false;
      if (filter.from && b.date < filter.from) return false;
      if (filter.to && b.date > filter.to) return false;
      return true;
    });
  }, [bets, filter]);

  // Key metrics
  const metrics = useMemo(() => {
    const settled = filteredBets.filter(b => isSettled(b.status));
    const pending = filteredBets.filter(b => b.status === 'Pending');

    const stakedAll = +filteredBets.reduce((s, b) => s + b.stake, 0).toFixed(2);
    const stakedSettled = +settled.reduce((s, b) => s + b.stake, 0).toFixed(2);
    const returned = +settled.reduce((s, b) => s + (effectiveReturn(b) ?? 0), 0).toFixed(2);
    const profit = +(returned - stakedSettled).toFixed(2);

    const wins = settled.filter(b => b.status === 'Won').length;
    const hitRate = settled.length ? wins / settled.length : 0;
    const roi = stakedSettled > 0 ? profit / stakedSettled : 0;

    const avgOdds = settled.length ? +(settled.reduce((s, b) => s + b.oddsDecimal, 0) / settled.length).toFixed(2) : 0;
    const avgStake = filteredBets.length ? +(filteredBets.reduce((s, b) => s + b.stake, 0) / filteredBets.length).toFixed(2) : 0;
    const medStake = +median(filteredBets.map(b => b.stake)).toFixed(2);
    const profitPerBet = settled.length ? +(profit / settled.length).toFixed(2) : 0;

    const pendingStake = +pending.reduce((s, b) => s + b.stake, 0).toFixed(2);
    const pendingPotentialReturn = +pending.reduce((s, b) => s + b.stake * b.oddsDecimal, 0).toFixed(2);

    return {
      totalBets: filteredBets.length,
      settled: settled.length,
      pending: pending.length,
      stakedAll,
      stakedSettled,
      returned,
      profit,
      hitRate,
      roi,
      avgOdds,
      avgStake,
      medStake,
      profitPerBet,
      pendingStake,
      pendingPotentialReturn,
    };
  }, [filteredBets]);

  // Monthly PnL from settled bets
  const monthly = useMemo(() => {
    const m = new Map<string, { staked: number; returned: number; profit: number }>();
    for (const b of filteredBets) {
      if (!isSettled(b.status)) continue;
      const key = b.date.slice(0, 7);
      const ret = effectiveReturn(b) ?? 0;
      const cur = m.get(key) ?? { staked: 0, returned: 0, profit: 0 };
      cur.staked += b.stake;
      cur.returned += ret;
      cur.profit += ret - b.stake;
      m.set(key, cur);
    }
    const rows = Array.from(m.entries())
      .map(([month, v]) => ({
        month,
        staked: +v.staked.toFixed(2),
        returned: +v.returned.toFixed(2),
        profit: +v.profit.toFixed(2),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return rows;
  }, [filteredBets]);

  // Sport breakdown
  const bySport = useMemo(() => {
    const m = new Map<Sport, { staked: number; returned: number; profit: number; settled: number; wins: number }>();
    for (const b of filteredBets) {
      const cur = m.get(b.sport) ?? { staked: 0, returned: 0, profit: 0, settled: 0, wins: 0 };
      if (isSettled(b.status)) {
        const ret = effectiveReturn(b) ?? 0;
        cur.settled += 1;
        cur.staked += b.stake;
        cur.returned += ret;
        cur.profit += ret - b.stake;
        if (b.status === 'Won') cur.wins += 1;
      }
      m.set(b.sport, cur);
    }
    return Array.from(m.entries())
      .map(([sport, v]) => ({
        sport,
        staked: +v.staked.toFixed(2),
        returned: +v.returned.toFixed(2),
        profit: +v.profit.toFixed(2),
        winRate: v.settled > 0 ? v.wins / v.settled : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [filteredBets]);

  // Football categories
  const byCategory = useMemo(() => {
    const fb = filteredBets.filter(b => b.sport === 'Football');
    type Stat = { staked: number; returned: number; profit: number; settled: number; wins: number };
    const m = new Map<FootballCategoryKey, Stat>();
    for (const b of fb) {
      const key = (b.category ?? 'Uncategorised') as FootballCategoryKey;
      const cur = m.get(key) ?? { staked: 0, returned: 0, profit: 0, settled: 0, wins: 0 };
      if (isSettled(b.status)) {
        const ret = effectiveReturn(b) ?? 0;
        cur.settled += 1;
        cur.staked += b.stake;
        cur.returned += ret;
        cur.profit += ret - b.stake;
        if (b.status === 'Won') cur.wins += 1;
      }
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([category, v]) => ({
        category,
        staked: +v.staked.toFixed(2),
        returned: +v.returned.toFixed(2),
        profit: +v.profit.toFixed(2),
        winRate: v.settled > 0 ? v.wins / v.settled : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [filteredBets]);

  // Odds bands calibration, settled only
  const oddsBands = useMemo(() => {
    const bands = [
      { label: '1.01 to 1.49', min: 1.01, max: 1.49 },
      { label: '1.50 to 1.99', min: 1.5, max: 1.99 },
      { label: '2.00 to 2.99', min: 2, max: 2.99 },
      { label: '3.00 to 4.99', min: 3, max: 4.99 },
      { label: '5.00 or more', min: 5, max: Infinity },
    ] as const;

    const settled = filteredBets.filter(b => isSettled(b.status));
    type Row = { band: string; bets: number; wins: number; avgOdds: number; implied: number; winRate: number; roi: number; profit: number };
    const rows: Row[] = [];

    for (const band of bands) {
      const inBand = settled.filter(b => b.oddsDecimal >= band.min && b.oddsDecimal <= band.max);
      const bets = inBand.length;
      if (!bets) {
        rows.push({ band: band.label, bets: 0, wins: 0, avgOdds: 0, implied: 0, winRate: 0, roi: 0, profit: 0 });
        continue;
      }
      const wins = inBand.filter(b => b.status === 'Won').length;
      const avgOdds = inBand.reduce((s, b) => s + b.oddsDecimal, 0) / bets;
      const implied = 1 / avgOdds;
      const winRate = wins / bets;
      const staked = inBand.reduce((s, b) => s + b.stake, 0);
      const returned = inBand.reduce((s, b) => s + (effectiveReturn(b) ?? 0), 0);
      const profit = +(returned - staked).toFixed(2);
      const roi = staked > 0 ? profit / staked : 0;
      rows.push({ band: band.label, bets, wins, avgOdds, implied, winRate, roi, profit });
    }
    return rows;
  }, [filteredBets]);

  // Weekday performance, settled only
  const byWeekday = useMemo(() => {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    type Stat = { staked: number; returned: number; profit: number; settled: number; wins: number };
    const map = new Map<string, Stat>();
    for (const b of filteredBets) {
      if (!isSettled(b.status)) continue;
      const key = dayName(b.date);
      const cur = map.get(key) ?? { staked: 0, returned: 0, profit: 0, settled: 0, wins: 0 };
      const ret = effectiveReturn(b) ?? 0;
      cur.settled += 1;
      cur.staked += b.stake;
      cur.returned += ret;
      cur.profit += ret - b.stake;
      if (b.status === 'Won') cur.wins += 1;
      map.set(key, cur);
    }
    return names.map(day => {
      const v = map.get(day) ?? { staked: 0, returned: 0, profit: 0, settled: 0, wins: 0 };
      const winRate = v.settled > 0 ? v.wins / v.settled : 0;
      const roi = v.staked > 0 ? v.profit / v.staked : 0;
      return { day, staked: +v.staked.toFixed(2), returned: +v.returned.toFixed(2), profit: +v.profit.toFixed(2), winRate, roi };
    }).sort((a, b) => b.profit - a.profit);
  }, [filteredBets]);

  // CSV export for analysis elsewhere, respects current filters
  function exportCSV() {
    const header = ['date', 'description', 'sport', 'category', 'stake', 'oddsDecimal', 'status', 'return', 'profit'];
    const rows = filteredBets.map(b => {
      const ret = effectiveReturn(b);
      const profit = isSettled(b.status) ? ((ret ?? 0) - b.stake).toFixed(2) : '';
      return [
        b.date,
        b.description.replaceAll(',', ' '),
        b.sport,
        b.sport === 'Football' ? (b.category ?? 'Uncategorised') : '',
        b.stake.toFixed(2),
        b.oddsDecimal.toFixed(2),
        b.status,
        ret == null ? '' : ret.toFixed(2),
        profit,
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roller-bets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const hasActiveFilter = filter.sport !== 'All' || filter.from || filter.to;

  return (
    <div className={state.theme === 'dark' ? 'min-h-screen bg-slate-950 text-slate-100' : 'min-h-screen bg-slate-50 text-slate-900'}>
      {!isClient ? (
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-center py-12"><div className="text-lg">Loading…</div></div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Insights</h1>
              <p className="text-xs sm:text-sm opacity-70">Stats by month, sport, category, odds bands, weekday.</p>
              {hasActiveFilter && (
                <p className="text-xs opacity-60 mt-1">
                  Showing {filter.sport !== 'All' ? `${filter.sport}` : 'All sports'}
                  {filter.from ? ` from ${filter.from}` : ''}{filter.to ? ` to ${filter.to}` : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={{
                  pathname: '/',
                  query: {
                    ...(filter.sport && filter.sport !== 'All' ? { sport: filter.sport } : {}),
                    ...(filter.from ? { from: filter.from } : {}),
                    ...(filter.to ? { to: filter.to } : {}),
                  },
                }}
                className={btnGhost}
              >
                Return to tracker
              </Link>
              <button className={btnGhost} type="button" onClick={exportCSV}>Export CSV</button>
            </div>
          </div>

          {/* Global Filters */}
          <div className={card}>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
              <div className="col-span-1 md:col-span-1">
                <label className="text-xs opacity-80">Sport</label>
                <select className={field} value={filter.sport} onChange={e => setFilter(f => ({ ...f, sport: e.target.value as Sport | 'All' }))}>
                  {(['All','Football','Cricket','Tennis','Other'] as const).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className="text-xs opacity-80">From</label>
                <input className={field} type="date" value={filter.from ?? ''} onChange={e => setFilter(f => ({ ...f, from: e.target.value || undefined }))} />
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className="text-xs opacity-80">To</label>
                <input className={field} type="date" value={filter.to ?? ''} onChange={e => setFilter(f => ({ ...f, to: e.target.value || undefined }))} />
              </div>
              <div className="col-span-2 md:col-span-1 flex justify-end">
                <button className={btnGhost + ' w-full'} onClick={() => setFilter({ sport: 'All' })}>Clear</button>
              </div>
            </div>
          </div>

          {/* Key metrics */}
          <div className={card}>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
              <Metric label="Avg odds" val={metrics.avgOdds.toFixed(2)} />
              <Metric label="Avg stake" val={currency.format(metrics.avgStake)} />
              <Metric label="Median stake" val={currency.format(metrics.medStake)} />
              <Metric label="Profit per bet" val={currency.format(metrics.profitPerBet)} num={metrics.profitPerBet} posNeg />
              <Metric label="ROI" val={percentFmt.format(metrics.roi)} />
              <Metric label="Hit rate" val={percentFmt.format(metrics.hitRate)} />
              <Metric label="Pending stake" val={currency.format(metrics.pendingStake)} />
              <Metric label="Pending potential" val={currency.format(metrics.pendingPotentialReturn)} />
            </div>
          </div>

          {/* Monthly table */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Monthly profit</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Staked</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Returned</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.length === 0 ? (
                    <tr><td colSpan={4} className="py-4 text-center text-slate-400">No settled bets yet</td></tr>
                  ) : monthly.map(r => (
                    <tr
                      key={r.month}
                      className="border-b border-slate-800/80 cursor-pointer"
                      onClick={() => setFilter(f => ({ ...f, from: `${r.month}-01`, to: endOfMonth(r.month) }))}
                      title="Filter to this month"
                    >
                      <td className="py-2 pr-3">{r.month}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sport performance */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Sport performance</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Sport</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Staked</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Returned</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Profit</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {bySport.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No settled bets yet</td></tr>
                  ) : bySport.map(r => (
                    <tr key={r.sport} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.sport}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Football categories */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Football categories</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Staked</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Returned</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Profit</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No settled football bets yet</td></tr>
                  ) : byCategory.map(r => (
                    <tr key={r.category as string} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.category}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Odds bands calibration */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Odds bands calibration</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Band</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Bets</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Wins</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Avg odds</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Implied</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Win rate</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Edge</th>
                    <th className="py-2 pr-3 text-right tabular-nums">ROI</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {oddsBands.map(r => (
                    <tr key={r.band} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.band}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.bets}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.wins}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.avgOdds ? r.avgOdds.toFixed(2) : '0.00'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.implied)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.winRate)}</td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.winRate - r.implied >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {percentFmt.format(r.winRate - r.implied)}
                      </td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.roi >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {percentFmt.format(r.roi)}
                      </td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weekday performance */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Weekday performance</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Day</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Staked</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Returned</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Profit</th>
                    <th className="py-2 pr-3 text-right tabular-nums">Win rate</th>
                    <th className="py-2 pr-3 text-right tabular-nums">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {byWeekday.map(r => (
                    <tr key={r.day} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.day}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 text-right tabular-nums ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.winRate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{percentFmt.format(r.roi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <footer className="text-center text-xs opacity-60 pt-2 pb-2">Insights are based on data in this browser.</footer>
        </div>
      )}
    </div>
  );

  function Metric({ label, val, num, posNeg = false }: { label: string; val: string; num?: number; posNeg?: boolean }) {
    const isNeg = posNeg && (num ?? 0) < 0;
    const isPos = posNeg && (num ?? 0) > 0;
    return (
      <div className="rounded-xl p-3 bg-slate-900/40 border border-slate-800">
        <div className="text-xs opacity-70">{label}</div>
        <div className={'text-lg font-semibold tabular-nums ' + (isPos ? 'text-emerald-400' : isNeg ? 'text-rose-400' : '')}>
          {val}
        </div>
      </div>
    );
  }
}
