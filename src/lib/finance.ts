// Домашняя бухгалтерия: долги (по контрагентам) и расходы/доходы.

import type { FinanceEntry, FinanceKind } from '../types';

export const FIN_LABEL: Record<FinanceKind, string> = {
  expense: 'Расход',
  income: 'Доход',
  lent: 'Дал в долг',
  borrowed: 'Взял в долг',
  return_in: 'Мне вернули',
  return_out: 'Я вернул',
};

export const DEBT_KINDS: FinanceKind[] = ['lent', 'borrowed', 'return_in', 'return_out'];

export const EXPENSE_CATEGORIES = [
  'Коммуналка',
  'Еда',
  'Транспорт',
  'Здоровье',
  'Дом',
  'Связь',
  'Одежда',
  'Развлечения',
  'Другое',
];

export function isDebt(k: FinanceKind): boolean {
  return k !== 'expense' && k !== 'income';
}

/** Вклад записи в баланс «мне должны» (+) / «я должен» (−). */
export function debtSign(k: FinanceKind): number {
  switch (k) {
    case 'lent':
    case 'return_out':
      return 1;
    case 'borrowed':
    case 'return_in':
      return -1;
    default:
      return 0;
  }
}

/** Форматирование суммы с разделителями тысяч и валютой. */
export function formatMoney(n: number, currency = ''): string {
  const s = Math.round(n).toLocaleString('ru-RU');
  return currency ? `${s} ${currency}` : s;
}

export interface PersonBalance {
  person: string;
  /** >0 — контрагент должен мне; <0 — я должен контрагенту. */
  net: number;
  last: string;
}

/** Балансы по всем контрагентам. */
export function personBalances(entries: FinanceEntry[]): PersonBalance[] {
  const m = new Map<string, { net: number; last: string }>();
  for (const e of entries) {
    if (e.deleted || !isDebt(e.kind) || !e.person) continue;
    const cur = m.get(e.person) ?? { net: 0, last: '' };
    cur.net += debtSign(e.kind) * e.amount;
    if (e.date > cur.last) cur.last = e.date;
    m.set(e.person, cur);
  }
  return [...m.entries()]
    .map(([person, v]) => ({ person, net: v.net, last: v.last }))
    .sort((a, b) => a.person.localeCompare(b.person));
}

/** Хронология по контрагенту с нарастающим балансом. */
export function personLedger(
  entries: FinanceEntry[],
  person: string,
): { entry: FinanceEntry; running: number }[] {
  const list = entries
    .filter((e) => !e.deleted && isDebt(e.kind) && e.person === person)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  let run = 0;
  return list.map((entry) => {
    run += debtSign(entry.kind) * entry.amount;
    return { entry, running: run };
  });
}

/** Итоги долгов: сколько мне должны и сколько должен я. */
export function debtTotals(balances: PersonBalance[]): { owedToMe: number; iOwe: number } {
  let owedToMe = 0;
  let iOwe = 0;
  for (const b of balances) {
    if (b.net > 0) owedToMe += b.net;
    else if (b.net < 0) iOwe += -b.net;
  }
  return { owedToMe, iOwe };
}

/** Список контрагентов (для автоподстановки). */
export function persons(entries: FinanceEntry[]): string[] {
  const s = new Set<string>();
  for (const e of entries) if (!e.deleted && e.person) s.add(e.person);
  return [...s].sort();
}

/** Расходы/доходы в диапазоне дат, свежие сверху. */
export function moneyInRange(entries: FinanceEntry[], from: string, to: string): FinanceEntry[] {
  return entries
    .filter((e) => !e.deleted && (e.kind === 'expense' || e.kind === 'income') && e.date >= from && e.date <= to)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

/** Суммы расходов/доходов и по категориям за набор записей. */
export function moneyTotals(list: FinanceEntry[]): {
  spent: number;
  income: number;
  byCategory: { category: string; sum: number }[];
} {
  let spent = 0;
  let income = 0;
  const cat = new Map<string, number>();
  for (const e of list) {
    if (e.kind === 'income') income += e.amount;
    else {
      spent += e.amount;
      const c = e.category || 'Другое';
      cat.set(c, (cat.get(c) ?? 0) + e.amount);
    }
  }
  const byCategory = [...cat.entries()]
    .map(([category, sum]) => ({ category, sum }))
    .sort((a, b) => b.sum - a.sum);
  return { spent, income, byCategory };
}
