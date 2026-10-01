// Paid-leave balance per employee (admins only).
// Rule: 24 paid days per financial year (April → March), earned 2 per month.
//   Apr = 2, May = 4 … Mar = 24. Unused days carry forward inside the year and
//   reset every 1 April.
// Taken = approved, non-reverted leave days in the current financial year.
//   • Sundays are not counted • half-day = 0.5
//   • On Duty, Permission, Work From Home and Late do NOT use paid leave
//   • Unauthorised leave is shown separately (loss of pay) and not deducted
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mergedName } from "@/lib/personMerge";

const PER_MONTH = 2;
const PER_YEAR = 24;
const NOT_PAID_LEAVE = new Set(["on_duty", "permission", "work_from_home", "late"]);

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function financialYear(today = new Date()) {
  const startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1; // April = 3
  const start = new Date(startYear, 3, 1);
  const end = new Date(startYear + 1, 2, 31);
  const monthsElapsed = (today.getFullYear() - startYear) * 12 + today.getMonth() - 3 + 1; // incl. current month
  return { start, end, startYear, monthsElapsed: Math.min(Math.max(monthsElapsed, 1), 12) };
}

/** Days of a request that fall inside [from, to], excluding Sundays; half-day = 0.5 */
function daysInRange(req: any, from: Date, to: Date): number {
  const s = new Date(req.start_date + "T00:00:00");
  const e = new Date((req.end_date || req.start_date) + "T00:00:00");
  if (req.is_half_day) {
    return s >= from && s <= to && s.getDay() !== 0 ? 0.5 : 0;
  }
  let n = 0;
  const c = new Date(Math.max(s.getTime(), from.getTime()));
  const last = new Date(Math.min(e.getTime(), to.getTime()));
  while (c <= last) {
    if (c.getDay() !== 0) n += 1;
    c.setDate(c.getDate() + 1);
  }
  return n;
}

export default function LeaveBalanceTable({ requests, search }: { requests: any[]; search: string }) {
  const fy = useMemo(() => financialYear(), []);
  const earned = Math.min(fy.monthsElapsed * PER_MONTH, PER_YEAR);

  const { data: employees = [] } = useQuery({
    queryKey: ["leave-balance-employees"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role, is_active")
        .order("full_name");
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    // count up to the end of the financial year so approved future leave is included too
    const countTo = fy.end;
    // One row per person: merged duplicates (e.g. Anu + Anu V) share a row and their
    // leaves add up — even if one of the accounts is an admin.
    const people: Array<{ key: string; name: string; ids: Set<string> }> = [];
    const byMerge: Record<string, { key: string; name: string; ids: Set<string> }> = {};
    for (const p of employees as any[]) {
      const target = mergedName(p.full_name);
      if (target) {
        if (!byMerge[target]) {
          byMerge[target] = { key: p.id, name: target, ids: new Set() };
          people.push(byMerge[target]);
        }
        byMerge[target].ids.add(p.id);
        continue;
      }
      if (p.is_active === false || p.role === "admin" || p.role === "super_admin") continue;
      people.push({ key: p.id, name: p.full_name, ids: new Set([p.id]) });
    }
    people.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return people
      .filter((e) => !search || (e.name ?? "").toLowerCase().includes(search.toLowerCase()))
      .map((e) => {
        let taken = 0;
        let lop = 0;
        for (const r of requests) {
          if (!e.ids.has(r.employee_id)) continue;
          if (r.status !== "approved" || r.reverted_at) continue;
          const cat = r.leave_category ?? r.type;
          if (NOT_PAID_LEAVE.has(cat) || r.type === "on_duty" || r.type === "permission") continue;
          const d = daysInRange(r, fy.start, countTo);
          if (cat === "unauthorised_leave") lop += d;
          else taken += d;
        }
        const balance = earned - taken;
        return { id: e.key, name: e.name, taken, lop, balance, yearLeft: PER_YEAR - taken };
      });
  }, [employees, requests, search, earned, fy]);

  const fyLabel = `Apr ${fy.startYear} – Mar ${fy.startYear + 1}`;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <div className="space-y-3">
      <div className="rounded-card bg-card p-4 shadow-card text-sm text-ink-secondary">
        <p className="font-medium text-ink-primary">Paid leave · Financial year {fyLabel}</p>
        <p className="mt-1">
          2 days are added every month (24 per year). Earned so far: <b className="text-ink-primary">{earned} days</b>.
          Unused days carry forward and reset on 1 April. On Duty, Permission, WFH and Late don't use leave;
          half-day = 0.5; Sundays aren't counted.
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-hidden rounded-card bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-ink-muted">
            <tr>
              <th className="text-left font-medium px-4 py-3">Employee</th>
              <th className="text-right font-medium px-4 py-3">Earned</th>
              <th className="text-right font-medium px-4 py-3">Taken</th>
              <th className="text-right font-medium px-4 py-3">Balance</th>
              <th className="text-right font-medium px-4 py-3">Left this year</th>
              <th className="text-right font-medium px-4 py-3">LOP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2.5 text-ink-primary">{r.name}</td>
                <td className="px-4 py-2.5 text-right">{earned}</td>
                <td className="px-4 py-2.5 text-right">{fmt(r.taken)}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${r.balance < 0 ? "text-destructive" : r.balance === 0 ? "text-warning" : "text-success"}`}>
                  {fmt(r.balance)}
                </td>
                <td className="px-4 py-2.5 text-right text-ink-secondary">{fmt(r.yearLeft)}</td>
                <td className="px-4 py-2.5 text-right text-ink-secondary">{r.lop ? fmt(r.lop) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-card bg-card p-3 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink-primary truncate">{r.name}</span>
              <span className={`shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold ${r.balance < 0 ? "bg-destructive-light text-destructive" : r.balance === 0 ? "bg-warning-light text-warning" : "bg-success-light text-success"}`}>
                {fmt(r.balance)} left
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-ink-muted">
              <span>Earned <b className="text-ink-primary">{earned}</b></span>
              <span>Taken <b className="text-ink-primary">{fmt(r.taken)}</b></span>
              <span>Year left <b className="text-ink-primary">{fmt(r.yearLeft)}</b></span>
            </div>
            {r.lop > 0 && <p className="mt-1 text-xs text-ink-muted">LOP: {fmt(r.lop)}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
