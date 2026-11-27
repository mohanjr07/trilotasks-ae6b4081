/** Leads: admins and the sales team only (also enforced in the database — TRILO_leads.sql). */
export const LEADS_EMAILS = ["aiswarya.v@triloautomation.com", "harishkanna@triloautomation.com", "harishkaanna@triloautomation.com"];

export function canSeeLeads(profile?: { role?: string | null; email?: string | null } | null): boolean {
  if (!profile) return false;
  return ["admin", "super_admin"].includes(profile.role ?? "") || LEADS_EMAILS.includes((profile.email ?? "").toLowerCase());
}

export type Lead = {
  id: string; sheet: "PD" | "PC"; sl_no: number | null; sso: string | null; name: string; location: string | null;
  reference: string | null; products: string | null; status: string | null; remarks: string | null;
  quoted_value: number | null; final_quoted_value: number | null; coverage_pct: number | null;
  expected_order_date: string | null; po_number: string | null; po_value: number | null;
  converted: boolean; converted_at: string | null; converted_by: string | null; sort: number | null;
};

export const inr = (v: number | null | undefined) =>
  v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Text for a new project made from a lead. */
export function leadProjectDraft(l: Lead) {
  const name = [l.name, l.location, l.products?.split("\n")[0]].filter(Boolean).join(" - ");
  const lines = [
    l.products && `Products: ${l.products.replace(/\n/g, ", ")}`,
    l.reference && `Reference: ${l.reference}`,
    l.sso && `SSO: ${l.sso}`,
    (l.final_quoted_value ?? l.quoted_value) != null && `Quoted value: ${inr(l.final_quoted_value ?? l.quoted_value)}`,
    l.po_number && `PO: ${l.po_number}${l.po_value != null ? ` (${inr(l.po_value)})` : ""}`,
    l.remarks && `Remarks: ${l.remarks}`,
  ].filter(Boolean);
  return { name, description: lines.join("\n") };
}
