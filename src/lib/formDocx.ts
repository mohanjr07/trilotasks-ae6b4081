// ─────────────────────────────────────────────────────────────────────────────
//  Fills the ORIGINAL Word template of a form with the submitted values and
//  the approval status, so the digital copy is the company's own form.
//  Works on the .docx XML in the browser (JSZip + DOMParser).
// ─────────────────────────────────────────────────────────────────────────────
import { format } from "date-fns";
import { loadDocxZip, setWordBookmarkText, type WordFieldLocator } from "@/lib/productionForms";
import { columnTotal, money, type FormData, type FormSchema } from "@/lib/formSchemas";
import type { FormRequestRow } from "@/components/FormDocument";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

type Ctx = { d: FormData; req: FormRequestRow; names: Record<string, string>; schema: FormSchema };
type Rule = {
  label: RegExp;
  field?: string;                       // value from data.fields
  value?: (c: Ctx) => string;           // or worked out
  part?: "body" | "header";
  mode?: "after" | "underscores";
};
type TableRule = { match: RegExp; table: string; cols: Array<string | null>; serial?: number };
type DocxMap = { rules: Rule[]; tables?: TableRule[]; expenseTotals?: boolean; signatures: "fill" | "append" };

const dmy = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("-") : v ?? "");
const stamp = (iso?: string | null) => (iso ? format(new Date(iso), "dd-MM-yyyy, h:mm a") : "");
const submitted = (c: Ctx) => format(new Date(c.req.submitted_at), "dd-MM-yyyy");

const approverStatus = (r: FormRequestRow) =>
  r.approved_at ? `✓ Approved\n${stamp(r.approved_at)}`
  : r.status === "rejected" && r.rejected_by === r.approver_id ? `✗ Rejected\n${stamp(r.rejected_at)}`
  : "Pending";
const authorizerStatus = (r: FormRequestRow) =>
  r.authorized_at ? `✓ Authorized\n${stamp(r.authorized_at)}`
  : r.status === "rejected" && r.rejected_by === r.authorizer_id ? `✗ Rejected\n${stamp(r.rejected_at)}`
  : "Pending";

// Where each value goes in each Word template.
const MAPS: Record<string, DocxMap> = {
  material_request: {
    rules: [
      { part: "header", label: /Project\s+Title/, field: "project_title" },
      { part: "header", label: /Project\s+No\.?\s*:/, field: "project_no" },
      { label: /^\s*To\b/, field: "to" },
      { label: /Date\s*:/, field: "date" },
    ],
    tables: [{ match: /Description.*Section/i, table: "items", cols: ["#", "description", "section", "qty", "remark"] }],
    signatures: "fill",
  },
  material_out: {
    rules: [
      { part: "header", label: /Date\s*:/, value: submitted },
      { label: /^\s*To\s*:/, field: "to" },
      { label: /Date\s*:/, field: "date" },
      { label: /Address\s+of\s+receive\w*\s*:/, field: "address" },
      { label: /Ph\s+No\s*:/, field: "phone" },
      { label: /Project\s*:/, field: "project" },
      { label: /Purpose\s*:/, field: "purpose" },
    ],
    tables: [{ match: /Item\s+no.*Make/i, table: "items", cols: ["#", "item_no", "make", "specification"] }],
    signatures: "append",
  },
  material_in: {
    rules: [
      { part: "header", label: /Date\s*:/, value: submitted },
      { label: /Ref\s*No\s*:/, field: "out_ref" },
      { label: /Date\s*:/, field: "date" },
      { label: /Project\s*:/, field: "project" },
      { label: /Purpose\s*:/, field: "purpose" },
    ],
    tables: [{ match: /Verified\s+Number/i, table: "items", cols: ["#", "item_no", "verified_number", "status"] }],
    signatures: "append",
  },
  quality_check_drawing: {
    rules: [
      { part: "header", label: /Date\s*:/, value: submitted },
      { label: /Date\s*:/, field: "date" },
      { label: /Project\s*:/, field: "project" },
      { label: /Purpose\s*:/, field: "purpose" },
    ],
    tables: [{ match: /Actual\s+Drawing/i, table: "checks", cols: ["#", "actual", "checked", "correction", "quality"] }],
    signatures: "append",
  },
  production: {
    rules: [
      { part: "header", label: /Date\s*:/, value: submitted },
      { label: /^\s*Date\s*:/, field: "date" },
      { label: /Project\s+Name\s*:/, field: "project_name" },
      { label: /Raw\s+Material\s*:/, field: "raw_material" },
      { label: /^\s*Part\s+No\s*:/, field: "part_no" },
      { label: /^\s*Qty\s*:/, field: "qty" },
      { label: /Required\s+By\s+Date\s*:/, field: "required_by" },
      { label: /Assembly\s+Name\s*&\s*Part\s+No\s*:/, field: "assembly" },
      { label: /^\s*Size\s*:/, field: "size" },
      { label: /^\s*Blank\s*:/, field: "blank" },
      { label: /Laser\s+Cutting/, field: "processes" },
    ],
    signatures: "append",
  },
  asset_submission: {
    rules: [
      { label: /HANDED\s+OVER\s+TO\s+MANAGER/, field: "handed_over" },
      { label: /Manager\s+Signature\s*:\s*_+/, mode: "underscores", value: (c) => (c.req.approved_at ? c.names[c.req.approver_id] ?? "" : "") },
      { label: /Signature\s*:\s*_+/, mode: "underscores", value: (c) => c.names[c.req.requested_by] ?? "" },
      { label: /Date\s*:/, value: submitted },
      { label: /Signature\s*:\s*_+/, mode: "underscores", value: (c) => (c.req.approved_at ? c.names[c.req.approver_id] ?? "" : "") },
      { label: /Date\s*:/, value: (c) => (c.req.approved_at ? format(new Date(c.req.approved_at), "dd-MM-yyyy") : "") },
    ],
    tables: [{ match: /Local\s+Disc/i, table: "files", cols: ["#", "description", "local", "drive"] }],
    signatures: "append",
  },
  expense_claim: {
    rules: [
      { label: /Name\s*:/, field: "name" },
      { label: /Department\s*:/, field: "department" },
      { label: /Claim\s+Month\s*:/, field: "claim_month" },
      { label: /Employee\s+ID\s*:/, field: "employee_id" },
      { label: /Designation\s*:/, field: "designation" },
      { label: /^\s*Date\s*:/, field: "date" },
      { label: /Less:\s*Advance\s+Taken\s*\(if\s+any\)/, value: (c) => (c.d.fields.advance ? money(parseFloat(c.d.fields.advance) || 0) : "") },
      { label: /NET\s+AMOUNT\s+PAYABLE\s*\/\s*REIMBURSABLE\s*\(INR\)/, value: (c) => c.schema.summary?.(c.d)[0]?.value ?? "" },
    ],
    tables: [{ match: /Category.*Vendor/i, table: "expenses", cols: ["date", "category", "description", "vendor", "mode", "bill_no", "amount", "gst", "total"] }],
    expenseTotals: true,
    signatures: "append",
  },
};

// ── tiny XML helpers ─────────────────────────────────────────────────────────
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const all = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS(W, name));
const textNodes = (el: Element) => all(el, "t");
const textOf = (el: Element) => textNodes(el).map((t) => t.textContent ?? "").join("");
const preserve = (t: Element) => t.setAttributeNS(XML_NS, "xml:space", "preserve");

function el(doc: Document, name: string, attrs: Record<string, string> = {}, children: Node[] = []) {
  const e = doc.createElementNS(W, `w:${name}`);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v);
  children.forEach((c) => e.appendChild(c));
  return e;
}

function makeRun(doc: Document, text: string, rPr?: Element | null, bold = false) {
  const r = el(doc, "r");
  const pr = rPr ? (rPr.cloneNode(true) as Element) : el(doc, "rPr");
  if (bold && !kids(pr, "b").length) pr.appendChild(el(doc, "b"));
  if (pr.childNodes.length) r.appendChild(pr);
  text.split("\n").forEach((line, i) => {
    if (i) r.appendChild(el(doc, "br"));
    const t = el(doc, "t");
    t.textContent = line;
    preserve(t);
    r.appendChild(t);
  });
  return r;
}

/** Replace a table cell's text, keeping its paragraph & font formatting. */
function setCellText(tc: Element, text: string) {
  const doc = tc.ownerDocument;
  const ps = kids(tc, "p");
  const firstRun = all(tc, "r")[0];
  const rPr = firstRun ? kids(firstRun, "rPr")[0] : null;
  ps.forEach((p) => Array.from(p.children).forEach((c) => { if (c.localName !== "pPr") p.removeChild(c); }));
  let p = ps[0];
  if (!p) { p = el(doc, "p"); tc.appendChild(p); }
  if (text) p.appendChild(makeRun(doc, text, rPr));
}

/** Put `value` right after the label inside a paragraph, eating some of the
 *  padding spaces that follow so a second label on the same line stays put. */
function insertAfterLabel(p: Element, re: RegExp, value: string) {
  const nodes = textNodes(p);
  const full = nodes.map((n) => n.textContent ?? "").join("");
  const m = re.exec(full);
  if (!m) return false;
  const end = m.index + m[0].length;
  let pos = 0;
  for (let i = 0; i < nodes.length; i++) {
    const t = nodes[i].textContent ?? "";
    if (end <= pos + t.length || i === nodes.length - 1) {
      const at = Math.min(end - pos, t.length);
      const before = t.slice(0, at);
      const needsSep = !/[\s]$/.test(before) && !/:$/.test(before) ? ": " : /:$/.test(before) ? " " : "";
      const ins = `${needsSep}${value}`;
      nodes[i].textContent = before + ins + t.slice(at);
      preserve(nodes[i]);
      // consume following spaces (keep at least 3 before the next word)
      let budget = ins.length;
      let j = i, k = at + ins.length;
      const rest = full.slice(end);
      const pad = (rest.match(/^\s*/)?.[0].length ?? 0);
      const hasMore = rest.trim().length > 0;
      budget = hasMore ? Math.max(0, Math.min(budget, pad - 3)) : 0;
      while (budget > 0 && j < nodes.length) {
        const s = nodes[j].textContent ?? "";
        let cut = 0;
        while (k + cut < s.length && /\s/.test(s[k + cut]) && cut < budget) cut++;
        if (cut) { nodes[j].textContent = s.slice(0, k) + s.slice(k + cut); budget -= cut; }
        if (k < s.length && !/\s/.test(s[k])) break;
        j++; k = 0;
      }
      return true;
    }
    pos += t.length;
  }
  return false;
}

function applyRule(doc: Document, used: Map<Element, Set<string>>, rule: Rule, value: string) {
  for (const p of all(doc, "p")) {
    const done = used.get(p) ?? new Set<string>();
    if (done.has(rule.label.source)) continue;   // same label already filled in this paragraph
    const text = textOf(p);
    if (!rule.label.test(text)) continue;
    done.add(rule.label.source);
    used.set(p, done);
    if (!value) return;
    if (rule.mode === "underscores") {
      for (const t of textNodes(p)) {
        if (/_{3,}/.test(t.textContent ?? "")) { t.textContent = (t.textContent ?? "").replace(/_{3,}/, ` ${value} `); preserve(t); return; }
      }
      return;
    }
    // Label-only cell beside an empty value cell (e.g. "Qty: | ____") → write in the value cell
    const tc = p.parentNode as Element;
    if (tc?.localName === "tc") {
      const leftover = textOf(tc).replace(rule.label, "").replace(/[\s:]/g, "");
      const next = tc.nextElementSibling;
      const multiPara = kids(tc, "p").filter((x) => textOf(x).trim()).length > 1;
      if ((leftover.length <= 3 || multiPara) && next?.localName === "tc" && textOf(next).trim().length <= 4) {
        setCellText(next, value);
        return;
      }
    }
    insertAfterLabel(p, rule.label, value);
    return;
  }
}

function fillTable(doc: Document, rule: TableRule, rows: Array<Record<string, string>>, schema: FormSchema) {
  const tbl = all(doc, "tbl").find((t) => rule.match.test(textOf(t)));
  if (!tbl) return;
  const trs = kids(tbl, "tr");
  const headerIdx = trs.findIndex((tr) => rule.match.test(textOf(tr)));
  let data = trs.slice(headerIdx + 1).filter((tr) => !/TOTAL/.test(textOf(tr)));
  if (!data.length) return;
  const cols = schema.tables?.find((t) => t.key === rule.table)?.columns ?? [];
  // add rows if needed (copies of the last empty row)
  while (data.length < rows.length) {
    const last = data[data.length - 1];
    const copy = last.cloneNode(true) as Element;
    kids(copy, "tc").forEach((tc) => setCellText(tc, ""));
    last.parentNode!.insertBefore(copy, last.nextSibling);
    data = [...data, copy];
  }
  rows.forEach((r, i) => {
    const tcs = kids(data[i], "tc");
    rule.cols.forEach((key, ci) => {
      if (!key || !tcs[ci]) return;
      if (key === "#") { setCellText(tcs[ci], String(i + 1)); return; }
      const col = cols.find((c) => c.key === key);
      const v = col?.compute ? col.compute(r) : r[key] ?? "";
      setCellText(tcs[ci], col?.type === "date" ? dmy(v) : v);
    });
  });
  return tbl;
}

function signatureTable(doc: Document, c: Ctx) {
  const border = () => ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => el(doc, b, { val: "single", sz: "6", space: "0", color: "000000" }));
  const cell = (text: string, bold = false, shade = false) => {
    const tcPr = el(doc, "tcPr", {}, [el(doc, "tcW", { w: "3200", type: "dxa" })]);
    if (shade) tcPr.appendChild(el(doc, "shd", { val: "clear", color: "auto", fill: "EEF2FF" }));
    const rPr = el(doc, "rPr", {}, [el(doc, "sz", { val: "20" })]);
    return el(doc, "tc", {}, [tcPr, el(doc, "p", {}, [el(doc, "pPr", {}, [el(doc, "spacing", { before: "60", after: "60" })]), makeRun(doc, text, rPr, bold)])]);
  };
  const r = c.req;
  const tbl = el(doc, "tbl", {}, [
    el(doc, "tblPr", {}, [el(doc, "tblW", { w: "5000", type: "pct" }), el(doc, "tblBorders", {}, border())]),
    el(doc, "tblGrid", {}, [el(doc, "gridCol", { w: "3200" }), el(doc, "gridCol", { w: "3200" }), el(doc, "gridCol", { w: "3200" })]),
    el(doc, "tr", {}, [cell("Requested by", true, true), cell("Approved by", true, true), cell("Authorized by", true, true)]),
    el(doc, "tr", {}, [
      cell(`${c.names[r.requested_by] ?? ""}\n${stamp(r.submitted_at)}`),
      cell(`${c.names[r.approver_id] ?? "Hari"}\n${approverStatus(r)}`),
      cell(`${c.names[r.authorizer_id] ?? ""}\n${authorizerStatus(r)}`),
    ]),
  ]);
  return tbl;
}

function noteParagraph(doc: Document, text: string, color = "B91C1C") {
  const rPr = el(doc, "rPr", {}, [el(doc, "color", { val: color }), el(doc, "sz", { val: "20" })]);
  return el(doc, "p", {}, [el(doc, "pPr", {}, [el(doc, "spacing", { before: "120" })]), makeRun(doc, text, rPr)]);
}

export async function buildFilledDocx(
  template: ArrayBuffer | Blob,
  schema: FormSchema,
  req: FormRequestRow,
  names: Record<string, string>,
  locator: WordFieldLocator | null,
): Promise<Blob> {
  const zip = await loadDocxZip(template);
  const map = MAPS[schema.key];
  const ctx: Ctx = { d: req.data ?? { fields: {}, tables: {} }, req, names, schema };
  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d+)\.xml$/.test(n));
  for (const part of parts) {
    let xml = await zip.file(part)!.async("text");
    // running reference number lives in a bookmark (same as "Use This")
    if (locator && req.reference_value && (locator.part ?? "word/document.xml") === part) {
      try { xml = setWordBookmarkText(xml, locator.name, req.reference_value); } catch { /* bookmark missing */ }
    }
    if (!map) { zip.file(part, xml); continue; }
    const doc = parser.parseFromString(xml, "application/xml");
    const isHeader = part !== "word/document.xml";
    const used = new Map<Element, Set<string>>();
    for (const rule of map.rules) {
      if ((rule.part ?? "body") === "header" ? !isHeader : isHeader) continue;
      const raw = rule.value ? rule.value(ctx) : ctx.d.fields?.[rule.field ?? ""] ?? "";
      const f = schema.fields.concat(schema.footerFields ?? []).find((x) => x.key === rule.field);
      applyRule(doc, used, rule, f?.type === "date" ? dmy(raw) : raw);
    }
    if (!isHeader) {
      for (const t of map.tables ?? []) fillTable(doc, t, ctx.d.tables?.[t.table] ?? [], schema);
      if (map.expenseTotals) {
        const tbl = all(doc, "tbl").find((t) => /Category.*Vendor/i.test(textOf(t)));
        const totalRow = tbl && kids(tbl, "tr").find((tr) => /TOTAL/.test(textOf(tr)));
        const cols = schema.tables?.[0]?.columns ?? [];
        const rows = ctx.d.tables?.expenses ?? [];
        if (totalRow) {
          const tcs = kids(totalRow, "tc");
          const vals = ["amount", "gst", "total"].map((k) => money(columnTotal(rows, cols.find((c) => c.key === k)!)));
          vals.forEach((v, i) => { const tc = tcs[tcs.length - 3 + i]; if (tc) setCellText(tc, v); });
        }
      }
      if (map.signatures === "fill") {
        for (const tr of all(doc, "tr")) {
          const tcs = kids(tr, "tc");
          const label = textOf(tcs[0] ?? tr);
          if (/Requested by/i.test(label)) { tcs[1] && setCellText(tcs[1], names[req.requested_by] ?? ""); tcs[2] && setCellText(tcs[2], `Submitted\n${stamp(req.submitted_at)}`); }
          if (/Approved by/i.test(label)) { tcs[1] && setCellText(tcs[1], names[req.approver_id] ?? "Hari"); tcs[2] && setCellText(tcs[2], approverStatus(req)); }
          if (/Authorized by/i.test(label)) { tcs[1] && setCellText(tcs[1], names[req.authorizer_id] ?? ""); tcs[2] && setCellText(tcs[2], authorizerStatus(req)); }
        }
      }
      const body = all(doc, "body")[0];
      const sectPr = kids(body, "sectPr")[0] ?? null;
      const add = (n: Node) => body.insertBefore(n, sectPr);
      if (map.signatures === "append") {
        add(noteParagraph(doc, " ", "000000"));
        add(signatureTable(doc, ctx));
      }
      if (req.status === "rejected" && req.reject_reason) add(noteParagraph(doc, `Rejected: ${req.reject_reason}`));
      add(noteParagraph(doc, "Digitally generated from TaskFlow — approvals recorded electronically with date and time.", "666666"));
    }
    zip.file(part, ser.serializeToString(doc));
  }
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
