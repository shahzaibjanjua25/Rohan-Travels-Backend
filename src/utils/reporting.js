/**
 * Date ranges and revenue arithmetic for reporting.
 *
 * Pure — no database. Reporting bugs are quiet: a wrong boundary or a
 * double-counted refund does not throw, it just prints a number that looks
 * plausible. Keeping this testable is the defence.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

/**
 * Resolve a named period to an inclusive-start, exclusive-end window.
 *
 * The end is exclusive so a booking created at 23:59:59.400 on the last day
 * is still counted — a `$lte endOfDay` comparison silently drops the final
 * fraction of a second.
 */
const resolveRange = (period = '30d', now = new Date()) => {
  const end = new Date(startOfDay(now).getTime() + DAY_MS);

  const spans = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

  if (period === 'today') return { start: startOfDay(now), end, label: 'Today' };
  if (period === 'all') return { start: new Date(0), end, label: 'All time' };
  if (period === 'mtd') {
    const s = startOfDay(now);
    s.setUTCDate(1);
    return { start: s, end, label: 'Month to date' };
  }
  if (period === 'ytd') {
    const s = startOfDay(now);
    s.setUTCMonth(0, 1);
    return { start: s, end, label: 'Year to date' };
  }

  const days = spans[period] || 30;
  return {
    start: new Date(end.getTime() - days * DAY_MS),
    end,
    label: `Last ${days} days`,
  };
};

/** Custom window from user-supplied dates, clamped to something sane. */
const customRange = (from, to) => {
  const start = startOfDay(from);
  const end = new Date(startOfDay(to).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) return null;
  if (end - start > 366 * 5 * DAY_MS) return null; // 5 years
  return { start, end, label: 'Custom range' };
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Net revenue.
 *
 * Ledger entries are written from the *customer's* perspective: a payment is
 * a debit (money leaving them), a refund is a credit (money returning). From
 * the company's side that inverts — collected payments are income, refunds
 * and fees paid back are not.
 *
 * Cancellation fees are revenue the company keeps, so they add rather than
 * subtract. Getting that sign wrong is the classic reporting error here.
 */
const computeRevenue = ({ payments = 0, refunds = 0, cancellationFees = 0, serviceFees = 0 }) => {
  const gross = round2(payments);
  const refunded = round2(refunds);
  const retained = round2(cancellationFees + serviceFees);
  return {
    gross,
    refunded,
    retainedFees: retained,
    net: round2(gross - refunded),
  };
};

/** Fill gaps so a chart does not skip days with no activity. */
const fillDailySeries = (rows, start, end) => {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const series = [];
  for (let t = startOfDay(start).getTime(); t < end.getTime(); t += DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    const row = byDay.get(key);
    series.push({ date: key, count: row?.count || 0, amount: round2(row?.amount || 0) });
  }
  return series;
};

module.exports = { resolveRange, customRange, computeRevenue, fillDailySeries, startOfDay, round2, DAY_MS };
