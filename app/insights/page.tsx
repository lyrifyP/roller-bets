'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

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

// Small bar chart with plain SVG
function BarChart({
  data,
  height = 180,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const padding = 16;
  const width = 720;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  if (!data.length) return <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">No data yet</div>;
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const barW = innerW / data.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]">
      {/* zero line */}
      <line
        x1={padding}
        x2={width - padding}
        y1={padding + innerH / 2}
        y2={padding + innerH / 2}
        stroke="currentColor"
        opacity={0.2}
      />
      {data.map((d, i) => {
        const x = padding + i * barW + barW * 0.1;
        const barWidth = barW * 0.8;
        const scaled = (Math.abs(d.value) / maxAbs) * (innerH / 2);
        const y = d.value >= 0 ? padding + innerH / 2 - scaled : padding + innerH / 2;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={scaled} fill="currentColor" opacity={d.value >= 0 ? 0.9 : 0.6} />
          </g>
        );
      })}
    </svg>
  );
}

export default function InsightsPage() {
  const [isClient, setIsClient] = useState(false);
  const [state, setState] = useState<AppState>({ targetProfit: 100, theme: 'dark' });
  const [bets, setBets] = useState<Bet[]>([]);

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

  // Monthly PnL from settled bets
  const monthly = useMemo(() => {
    const m = new Map<string, { staked: number; returned: number; profit: number }>();
    for (const b of bets) {
      if (!isSettled(b.status)) continue;
      const key = b.date.slice(0, 7); // yyyy-mm
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
  }, [bets]);

  // Sport breakdown
  const bySport = useMemo(() => {
    const m = new Map<Sport, { staked: number; returned: number; profit: number; settled: number; wins: number }>();
    for (const b of bets) {
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
  }, [bets]);

  // Football categories
  const byCategory = useMemo(() => {
    const fb = bets.filter(b => b.sport === 'Football');
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
  }, [bets]);

  const monthlyBars = monthly.map(r => ({ label: r.month, value: r.profit }));

  // CSV export for analysis elsewhere
  function exportCSV() {
    const header = [
      'date',
      'description',
      'sport',
      'category',
      'stake',
      'oddsDecimal',
      'status',
      'return',
      'profit',
    ];
    const rows = bets.map(b => {
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

  return (
    <div className={state.theme === 'dark' ? 'min-h-screen bg-slate-950 text-slate-100' : 'min-h-screen bg-slate-50 text-slate-900'}>
      {!isClient ? (
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-center py-12"><div className="text-lg">Loading...</div></div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Insights</h1>
              <p className="text-xs sm:text-sm opacity-70">Monthly PnL, sport split, football categories.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className={btnGhost}>Back to tracker</Link>
              <button className={btnGhost} type="button" onClick={exportCSV}>Export CSV</button>
            </div>
          </div>

          {/* Monthly PnL */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Monthly profit</div>
              <div className="text-xs opacity-60">settled only</div>
            </div>
            <div className="text-indigo-400">
              <BarChart data={monthlyBars} />
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3">Staked</th>
                    <th className="py-2 pr-3">Returned</th>
                    <th className="py-2 pr-3">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.length === 0 ? (
                    <tr><td colSpan={4} className="py-4 text-center text-slate-400">No settled bets yet</td></tr>
                  ) : monthly.map(r => (
                    <tr key={r.month} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.month}</td>
                      <td className="py-2 pr-3">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sport breakdown */}
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
                    <th className="py-2 pr-3">Staked</th>
                    <th className="py-2 pr-3">Returned</th>
                    <th className="py-2 pr-3">Profit</th>
                    <th className="py-2 pr-3">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {bySport.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No settled bets yet</td></tr>
                  ) : bySport.map(r => (
                    <tr key={r.sport} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.sport}</td>
                      <td className="py-2 pr-3">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                      <td className="py-2 pr-3">{percentFmt.format(r.winRate)}</td>
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
                    <th className="py-2 pr-3">Staked</th>
                    <th className="py-2 pr-3">Returned</th>
                    <th className="py-2 pr-3">Profit</th>
                    <th className="py-2 pr-3">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No settled football bets yet</td></tr>
                  ) : byCategory.map(r => (
                    <tr key={r.category as string} className="border-b border-slate-800/80">
                      <td className="py-2 pr-3">{r.category}</td>
                      <td className="py-2 pr-3">{currency.format(r.staked)}</td>
                      <td className="py-2 pr-3">{currency.format(r.returned)}</td>
                      <td className={'py-2 pr-3 ' + (r.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {currency.format(r.profit)}
                      </td>
                      <td className="py-2 pr-3">{percentFmt.format(r.winRate)}</td>
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
}
