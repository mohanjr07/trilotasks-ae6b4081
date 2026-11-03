// ─────────────────────────────────────────────────────────────────────────────
//  Fill a form's table (and its top fields) from an Excel / CSV file.
//  • Rows above the table header like "Name | Ravi" fill the matching fields.
//  • The header row is found by matching the column names (flexible wording:
//    "Particulars", "Invoice No", "Tax", "Amt"… are understood).
//  • A template with the right columns can be downloaded.
// ─────────────────────────────────────────────────────────────────────────────
import type { FormData, FormField, FormSchema, FormTable, TableColumn } from "@/lib/formSchemas";
import { saveFile } from "@/lib/nativeFiles";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// wording people use in their own sheets, checked in this order (GST before Amount, etc.)
const ALIASES: Array<[string, RegExp]> = [
  ["gst", /\b(gst|tax|igst|cgst|sgst|vat)\b/],
  ["total", /\btotal\b/],
  ["amount", /\b(amount|amt|value|cost|price|rs|inr)\b/],
  ["bill_no", /\b(bill|invoice|receipt|voucher|ref)\b.*\b(no|number|num)\b|\binvoice\b|\bbill no\b/],
  ["date", /\bdate\b|\bdated\b|\bday\b/],
  ["mode", /\bmode\b|\bpaid (by|via|through)\b|\bpayment (type|method)\b|\bpayment\b/],
  ["vendor", /\b(vendor|supplier|shop|party|merchant|paid to|payee|store)\b/],
  ["category", /\b(category|head|type|expense head|nature)\b/],
  ["description", /\b(desc|description|purpose|particular|particulars|detail|details|remark|remarks|item|items|narration)\b/],
];

function matchColumn(header: string, cols: TableColumn[], taken: Set<string>): TableColumn | "total" | null {
  const h = norm(header);
  if (!h) return null;
  const exact = cols.find((c) => !taken.has(c.key) && norm(c.label) === h);
  if (exact) return exact;
  for (const [key, re] of ALIASES) {
    if (!re.test(h)) continue;
    if (key === "total") return "total";
    const c = cols.find((x) => x.key === key && !taken.has(x.key));
    if (c) return c;
  }
  // other forms: all words of the column name appear in the header
  return cols.find((c) => !taken.has(c.key) && norm(c.label).split(" ").every((w) => h.includes(w))) ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "03/11/2026", "3-Nov-26", "2026-11-03", Excel serial 46329 → "2026-11-03" (day first, Indian style). */
function toIsoDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) return isoOf(new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
  const s = String(v ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  m = /^(\d{1,2})[-/. ]?([a-z]{3})[a-z]*[-/., ]+(\d{2,4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(+m[1])}`;
  }
  return "";
}

const toNumber = (v: unknown) => {
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  const s = String(v ?? "").replace(/[₹,\s]|rs\.?|inr/gi, "");
  const n = parseFloat(s);
  return isFinite(n) ? String(Math.round(n * 100) / 100) : "";
};

function pickOption(v: string, options: string[] = []) {
  const s = norm(v);
  if (!s) return "";
  return options.find((o) => norm(o) === s)
    ?? options.find((o) => norm(o).includes(s) || s.includes(norm(o)))
    ?? options.find((o) => norm(o).split(" ")[0] === s.split(" ")[0])
    ?? (/gpay|phonepe|paytm|google pay/.test(s) ? options.find((o) => /upi/i.test(o)) : undefined)
    ?? (/neft|rtgs|imps|bank/.test(s) ? options.find((o) => /bank/i.test(o)) : undefined)
    ?? (/credit|debit/.test(s) ? options.find((o) => /card/i.test(o)) : undefined)
    ?? "";
}

function cellValue(c: any): unknown {
  const v = c?.value;
  if (v == null) return "";
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result ?? "";
    if ("richText" in v) return (v.richText as Array<{ text: string }>).map((t) => t.text).join("");
    if ("text" in v) return v.text;
    return "";
  }
  return v;
}

function parseCsv(text: string): unknown[][] {
  const out: unknown[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); out.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

async function readGrid(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return parseCsv(await file.text());
  if (/\.xls$/i.test(file.name)) throw new Error("Old .xls files can't be read — open it in Excel and save as .xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  // the sheet with the most filled rows
  let best: unknown[][] = [];
  wb.eachSheet((ws) => {
    const grid: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const vals: unknown[] = [];
      for (let c = 1; c <= Math.max(r.cellCount, ws.columnCount); c++) vals.push(cellValue(r.getCell(c)));
      grid[n - 1] = vals;
    });
    const filled = (g: unknown[][]) => g.filter((r) => r?.some((v) => String(v ?? "").trim())).length;
    if (filled(grid) > filled(best)) best = Array.from(grid, (r) => r ?? []);
  });
  return best;
}

export type ExcelImportResult = { fields: Record<string, string>; rows: Array<Record<string, string>>; skipped: number };

export async function importFormExcel(file: File, schema: FormSchema, table: FormTable): Promise<ExcelImportResult> {
  const grid = await readGrid(file);
  const cols = table.columns.filter((c) => !c.readOnly && !c.compute);
  const allFields: FormField[] = [...schema.fields, ...(schema.footerFields ?? [])].filter((f) => f.type !== "project");

  // 1. find the header row (at least two column names matched)
  let headerAt = -1; let map: Array<TableColumn | "total" | null> = [];
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const taken = new Set<string>();
    const m = (grid[i] ?? []).map((v) => {
      const c = matchColumn(String(v ?? ""), cols, taken);
      if (c && c !== "total") taken.add(c.key);
      return c;
    });
    if (m.filter((c) => c && c !== "total").length >= 2) { headerAt = i; map = m; break; }
  }
  if (headerAt < 0) throw new Error(`Couldn't find the table headings (${cols.map((c) => c.label).join(", ")}) in the file`);

  // 2. "Label | value" lines anywhere above (or below) the table fill the top fields
  const fields: Record<string, string> = {};
  const fieldAt = (label: string) => {
    const l = norm(label.replace(/[:：]\s*$/, ""));
    return l ? allFields.find((f) => norm(f.label) === l || norm(f.label).startsWith(l + " ") || (l.length > 3 && norm(f.label).includes(l))) : undefined;
  };
  // returns true when the row was a "Label | value" line
  const takeFieldRow = (r: unknown[]) => {
    const c = r.findIndex((v) => String(v ?? "").trim() !== "");
    if (c < 0 || typeof r[c] !== "string") return false;
    const f = fieldAt(r[c] as string);
    if (!f) return false;
    const val = r.slice(c + 1).find((v) => String(v ?? "").trim() !== "");
    if (val === undefined || fields[f.key]) return true;
    const out = f.type === "date" ? toIsoDate(val) : f.type === "number" ? toNumber(val)
      : f.type === "select" ? pickOption(String(val), f.options) : String(val instanceof Date ? toIsoDate(val) : val).trim();
    if (out) fields[f.key] = out;
    return true;
  };
  for (let i = 0; i < headerAt; i++) takeFieldRow(grid[i] ?? []);

  // 3. table rows until the file ends (TOTAL / empty rows are skipped)
  const rows: Array<Record<string, string>> = []; let skipped = 0;
  for (let i = headerAt + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (!r.some((v) => String(v ?? "").trim())) continue;
    if (r.some((v) => /^\s*(grand\s*|net\s*)?total\b/i.test(String(v ?? "")))) continue;
    // a non-table line under the table, e.g. "Less: Advance Taken | 500"
    const firstText = r.find((v) => String(v ?? "").trim() !== "");
    if (typeof firstText === "string" && isNaN(+firstText) && !toIsoDate(firstText) && takeFieldRow(r)) continue;
    const out: Record<string, string> = Object.fromEntries(table.columns.map((c) => [c.key, ""]));
    let total = "";
    map.forEach((c, j) => {
      if (!c) return;
      const v = r[j];
      if (c === "total") { total = toNumber(v); return; }
      out[c.key] = c.type === "date" ? toIsoDate(v) : c.type === "number" ? toNumber(v)
        : c.type === "select" ? pickOption(String(v ?? ""), c.options) : String(v instanceof Date ? toIsoDate(v) : v ?? "").trim();
    });
    // only a total given → use it as the amount
    if (!out.amount && total && "amount" in out) out.amount = out.gst ? String(+total - +out.gst) : total;
    if (!cols.some((c) => out[c.key])) { skipped++; continue; }
    rows.push(out);
  }
  return { fields, rows, skipped };
}

/** An .xlsx with the form's fields (pre-filled) and the table headings, ready to fill. */
export async function downloadFormTemplate(schema: FormSchema, table: FormTable, data: FormData) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.label.slice(0, 30));
  ws.addRow([schema.heading ?? schema.title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const f of [...schema.fields, ...(schema.footerFields ?? [])].filter((x) => x.type !== "project")) {
    const r = ws.addRow([f.label, data.fields?.[f.key] ?? ""]);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
  const cols = table.columns.filter((c) => !c.readOnly && !c.compute);
  const h = ws.addRow(cols.map((c) => data.headings?.[table.key]?.[c.key] ?? c.label));
  h.font = { bold: true };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; c.border = { bottom: { style: "thin" } }; });
  const first = ws.rowCount + 1;
  for (let i = 0; i < 20; i++) ws.addRow(cols.map(() => ""));
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.label.length + 4, i === 0 ? 30 : 0);
    for (let r = first; r < first + 20; r++) {
      const cell = ws.getRow(r).getCell(i + 1);
      if (c.type === "date") cell.numFmt = "dd-mm-yyyy";
      if (c.type === "number") cell.numFmt = "#,##0.00";
      if (c.type === "select" && c.options?.length) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.options.join(",")}"`] };
    }
  });
  ws.getColumn(1).width = 30;
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${(schema.title).replace(/[\\/:*?"<>|]/g, "-")} - template.xlsx`);
}
