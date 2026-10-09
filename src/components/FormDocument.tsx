// The digital copy of a filled form — same layout on screen, in print and in
// the PDF. Always rendered black-on-white (like paper), even in dark mode.
import { forwardRef } from "react";
import { format } from "date-fns";
import { approverFor, needsApproval, columnTotal, money, type FormData, type FormSchema } from "@/lib/formSchemas";

export type FormRequestRow = {
  id: string;
  form_id: string;
  form_title: string;
  reference_value: string | null;
  revision?: number | null;
  data: FormData;
  requested_by: string;
  approver_id: string | null;
  authorizer_id: string;
  status: "pending_approval" | "pending_authorization" | "authorized" | "rejected";
  approved_at: string | null;
  authorized_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  submitted_at: string;
  created_at: string;
};

const fmt = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd-MM-yyyy, h:mm a") : "");
const fmtValue = (v: string | undefined, type?: string) => {
  if (!v) return "";
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("-");
  return v;
};

const cell: React.CSSProperties = { border: "1px solid #333", padding: "6px 8px", verticalAlign: "top", fontSize: 12 };
const head: React.CSSProperties = { ...cell, background: "#eef2ff", fontWeight: 600, textAlign: "left" };

type Props = {
  schema: FormSchema;
  request: FormRequestRow;
  names: Record<string, string>;
};

const FormDocument = forwardRef<HTMLDivElement, Props>(function FormDocument({ schema, request, names }, ref) {
  const d = request.data ?? { fields: {}, tables: {} };
  const rejectedByApprover = request.status === "rejected" && request.rejected_by === request.approver_id;
  const rejectedByAuthorizer = request.status === "rejected" && request.rejected_by === request.authorizer_id;

  const stamp = (state: "done" | "rejected" | "waiting", when?: string | null, doneLabel = "✓ APPROVED") => (
    <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: state === "done" ? "#15803d" : state === "rejected" ? "#b91c1c" : "#a16207" }}>
      {state === "done" ? doneLabel : state === "rejected" ? "✗ REJECTED" : "PENDING"}
      {when ? <div style={{ fontWeight: 400, color: "#444" }}>{fmt(when)}</div> : null}
    </div>
  );

  const fieldRows = (fields: typeof schema.fields) => {
    const rows: React.ReactNode[] = [];
    let pair: typeof schema.fields = [];
    const flush = () => {
      if (!pair.length) return;
      rows.push(
        <tr key={pair.map((p) => p.key).join("-")}>
          {pair.map((f) => (
            <FieldCells key={f.key} label={f.label} span={pair.length === 1 ? 3 : 1}
              value={f.type === "checks"
                ? (f.options ?? []).map((o) => `${(d.fields?.[f.key] ?? "").split(", ").includes(o) ? "☑" : "☐"} ${o}`).join("     ")
                : fmtValue(d.fields?.[f.key], f.type)} />
          ))}
        </tr>,
      );
      pair = [];
    };
    for (const f of fields) {
      if (f.wide || f.type === "textarea") { flush(); pair = [f]; flush(); continue; }
      pair.push(f);
      if (pair.length === 2) flush();
    }
    flush();
    return rows;
  };

  return (
    <div
      ref={ref}
      style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif", padding: 28, width: 794, maxWidth: "100%", boxSizing: "border-box" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #111", paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>TRILO AUTOMATION PRIVATE LIMITED</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, textTransform: "uppercase" }}>{schema.heading ?? request.form_title}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          {request.reference_value && (
            <div><b>Ref No:</b> {request.reference_value}</div>
          )}
          <div><b>Submitted:</b> {fmt(request.submitted_at)}</div>
        </div>
      </div>

      {/* Fields */}
      {schema.fields.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
          <tbody>{fieldRows(schema.fields)}</tbody>
        </table>
      )}

      {/* Tables */}
      {(schema.tables ?? []).map((t) => {
        const rows = (d.tables?.[t.key] ?? []).filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
        return (
          <div key={t.key} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t.label}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {t.serial && <th style={{ ...head, width: 40 }}>S.No</th>}
                  {t.columns.map((c) => <th key={c.key} style={{ ...head, width: c.width }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td style={{ ...cell, color: "#888" }} colSpan={t.columns.length + (t.serial ? 1 : 0)}>—</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i}>
                    {t.serial && <td style={cell}>{i + 1}</td>}
                    {t.columns.map((c) => <td key={c.key} style={cell}>{c.compute ? c.compute(r) : fmtValue(r[c.key], c.type)}</td>)}
                  </tr>
                ))}
                {t.totals?.length ? (
                  <tr>
                    {t.serial && <td style={head} />}
                    {t.columns.map((c, ci) => (
                      <td key={c.key} style={{ ...head, textAlign: t.totals!.includes(c.key) ? "left" : "right" }}>
                        {t.totals!.includes(c.key) ? money(columnTotal(rows, c))
                          : ci === t.columns.findIndex((x) => t.totals!.includes(x.key)) - 1 ? "TOTAL" : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        );
      })}

      {(schema.footerFields ?? []).length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
          <tbody>{fieldRows(schema.footerFields ?? [])}</tbody>
        </table>
      )}

      {schema.summary?.(d).map((s) => (
        <table key={s.label} style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <tbody><tr><td style={{ ...head, width: "70%" }}>{s.label}</td><td style={{ ...cell, fontWeight: 700 }}>{s.value}</td></tr></tbody>
        </table>
      ))}

      {(schema.notes ?? []).map((n) => (
        <p key={n} style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.45 }}>{n}</p>
      ))}

      {/* Signatures */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 22 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: needsApproval(request.form_title) ? "33%" : "50%" }}>Requested by</th>
            {needsApproval(request.form_title) && <th style={{ ...head, width: "33%" }}>Approved by</th>}
            <th style={{ ...head }}>Authorized by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cell, height: 70 }}>
              <div style={{ fontWeight: 700 }}>{names[request.requested_by] ?? "—"}</div>
              <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>{fmt(request.submitted_at)}</div>
            </td>
            {needsApproval(request.form_title) && (
              <td style={cell}>
                <div style={{ fontWeight: 700 }}>{names[request.approver_id] ?? approverFor(request.form_title).name}</div>
                {request.approved_at ? stamp("done", request.approved_at) : rejectedByApprover ? stamp("rejected", request.rejected_at) : stamp("waiting")}
              </td>
            )}
            <td style={cell}>
              <div style={{ fontWeight: 700 }}>{names[request.authorizer_id] ?? "—"}</div>
              {request.authorized_at ? stamp("done", request.authorized_at, "✓ AUTHORIZED")
                : rejectedByAuthorizer ? stamp("rejected", request.rejected_at)
                : stamp("waiting")}
            </td>
          </tr>
        </tbody>
      </table>

      {request.status === "rejected" && request.reject_reason && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #b91c1c", color: "#b91c1c", fontSize: 12 }}>
          <b>Rejection reason:</b> {request.reject_reason}
        </div>
      )}
      <div style={{ marginTop: 14, fontSize: 10, color: "#666" }}>
        Digitally generated from TaskFlow — approvals are recorded electronically with date and time.
      </div>
    </div>
  );
});

function FieldCells({ label, value, span }: { label: string; value: string; span: number }) {
  return (
    <>
      <td style={{ ...head, width: "18%" }}>{label}</td>
      <td style={{ ...cell, whiteSpace: "pre-wrap" }} colSpan={span}>{value}</td>
    </>
  );
}

export default FormDocument;
