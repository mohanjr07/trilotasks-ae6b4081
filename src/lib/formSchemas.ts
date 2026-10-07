// ─────────────────────────────────────────────────────────────────────────────
//  Digital versions of the Word forms in "Forms and Formats".
//  Each schema is matched to an uploaded form by its title, and drives both
//  the fill-in screen and the printable / PDF copy.
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType = "text" | "textarea" | "number" | "date" | "time" | "select" | "checks" | "lookup";

export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];      // for "select" / "checks" (tick any)
  placeholder?: string;
  wide?: boolean;          // full row on the form / document
  lookup?: "refs";         // "lookup": pick from running numbers issued on any form (typing still allowed)
};

export type TableColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: string[];
  width?: string;          // e.g. "30%" in the printed copy
  readOnly?: boolean;      // fixed text (e.g. the document name in a checklist)
  compute?: (row: Record<string, string>) => string; // read-only, worked out from the row
};

export type FormTable = {
  key: string;
  label: string;
  columns: TableColumn[];
  minRows?: number;        // rows shown when the form opens
  serial?: boolean;        // auto "S.No" column
  totals?: string[];       // number columns summed in a TOTAL row
  fixedRows?: Array<Record<string, string>>; // a fixed list (checklist) — no adding / removing rows
};

export type FormSchema = {
  key: string;
  title: string;
  match: RegExp;           // matched against production_forms.title
  fields: FormField[];
  tables?: FormTable[];
  footerFields?: FormField[]; // fields printed after the tables (remarks etc.)
  heading?: string;           // title printed on the copy (defaults to the form title)
  notes?: string[];           // fixed text printed on the copy (declarations etc.)
  summary?: (d: FormData) => Array<{ label: string; value: string }>; // worked-out lines (net amount…)
  noApproval?: boolean;       // goes straight to the authorizer (no "Approved by" step)
};

export type FormData = {
  fields: Record<string, string>;
  tables: Record<string, Array<Record<string, string>>>;
};

// Used for any form that doesn't have its own definition yet.
export const GENERIC_SCHEMA: FormSchema = {
  key: "generic",
  title: "Form",
  match: /.*/,
  fields: [
    { key: "date", label: "Date", type: "date", required: true },
    { key: "department", label: "Department", type: "text" },
    { key: "purpose", label: "Purpose / Details", type: "textarea", required: true, wide: true },
  ],
  tables: [
    {
      key: "items",
      label: "Items",
      serial: true,
      minRows: 3,
      columns: [
        { key: "description", label: "Description", width: "50%" },
        { key: "qty", label: "Qty", type: "number", width: "12%" },
        { key: "unit", label: "Unit", width: "12%" },
        { key: "remarks", label: "Remarks" },
      ],
    },
  ],
  footerFields: [{ key: "remarks", label: "Remarks", type: "textarea", wide: true }],
};


const num = (v: string | undefined) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isFinite(n) ? n : 0;
};
export const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const columnTotal = (rows: Array<Record<string, string>>, col: TableColumn) =>
  rows.reduce((s, r) => s + num(col.compute ? col.compute(r) : r[col.key]), 0);

// Built from the Word templates uploaded in Forms and Formats.
export const FORM_SCHEMAS: FormSchema[] = [
  {
    key: "material_request",
    title: "Material Request Form",
    heading: "MATERIAL REQUISITION",
    match: /material\s*request/i,
    fields: [
      { key: "to", label: "To", type: "text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "project_title", label: "Project Title", type: "text", required: true },
      { key: "project_no", label: "Project No.", type: "text" },
    ],
    notes: ["Kindly issue the understated materials for the above-mentioned project."],
    tables: [{
      key: "items", label: "Materials", serial: true, minRows: 3,
      columns: [
        { key: "description", label: "Description", width: "42%" },
        { key: "section", label: "Section", width: "18%" },
        { key: "qty", label: "Qty", type: "number", width: "10%" },
        { key: "remark", label: "Remark" },
      ],
    }],
  },
  {
    key: "material_out",
    title: "MATERIAL OUT FORM",
    match: /material\s*out/i,
    fields: [
      { key: "to", label: "To", type: "text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "address", label: "Address of receiver", type: "textarea", wide: true },
      { key: "phone", label: "Ph No", type: "text" },
      { key: "project", label: "Project", type: "text", required: true },
      { key: "purpose", label: "Purpose", type: "text", required: true, wide: true },
    ],
    tables: [{
      key: "items", label: "Items", serial: true, minRows: 3,
      columns: [
        { key: "item_no", label: "Item no.", width: "25%" },
        { key: "make", label: "Make", width: "25%" },
        { key: "specification", label: "Specification" },
      ],
    }],
  },
  {
    key: "material_in",
    title: "MATERIAL IN FORM",
    match: /material\s*in\b/i,
    fields: [
      { key: "out_ref", label: "Material OUT No / Ref No", type: "lookup", lookup: "refs", required: true,
        placeholder: "Pick a reference number" },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "project", label: "Project", type: "text", required: true },
      { key: "purpose", label: "Purpose", type: "text", required: true },
    ],
    tables: [{
      key: "items", label: "Items", serial: true, minRows: 3,
      columns: [
        { key: "item_no", label: "Item no.", width: "30%" },
        { key: "verified_number", label: "Verified Number", width: "30%" },
        { key: "status", label: "Verification Status", type: "select", options: ["OK", "Not OK", "Pending"] },
      ],
    }],
  },
  {
    key: "quality_check_drawing",
    title: "Quality Check Drawing form",
    heading: "QUALITY CHECK DRAWING FORM",
    match: /quality\s*check/i,
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "project", label: "Project", type: "text", required: true },
      { key: "purpose", label: "Purpose", type: "text", wide: true },
    ],
    tables: [{
      key: "checks", label: "Drawing checks", serial: true, minRows: 3,
      columns: [
        { key: "actual", label: "Actual Drawing Dimensions", width: "28%" },
        { key: "checked", label: "Checked Drawing Dimensions", width: "28%" },
        { key: "correction", label: "Correction (Y/N)", type: "select", options: ["Y", "N"], width: "14%" },
        { key: "quality", label: "Quality" },
      ],
    }],
  },
  {
    key: "production",
    title: "Production form",
    heading: "PRODUCTION REQUEST FORM",
    match: /production/i,
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "project_name", label: "Project Name", type: "text", required: true },
      { key: "raw_material", label: "Raw Material", type: "text" },
      { key: "part_no", label: "Part No", type: "text" },
      { key: "qty", label: "Qty", type: "number", required: true },
      { key: "required_by", label: "Required By Date", type: "date", required: true },
      { key: "assembly", label: "Assembly Name & Part No", type: "text", wide: true },
      { key: "size", label: "Size", type: "text" },
      { key: "blank", label: "Blank", type: "text" },
      { key: "processes", label: "Processes", type: "checks", wide: true,
        options: ["Laser Cutting", "Bending", "Welding", "Powder Coating", "Cutting & Grinding"] },
    ],
  },
  {
    key: "asset_submission",
    title: "Asset Submission Form",
    heading: "ASSET SUBMISSION FORM",
    match: /asset\s*submission/i,
    fields: [{ key: "date", label: "Date", type: "date", required: true }],
    tables: [{
      key: "files", label: "All Files Storage Location", serial: true, minRows: 3,
      columns: [
        { key: "description", label: "Description", width: "30%" },
        { key: "local", label: "Local Disc System Storage Location", width: "35%" },
        { key: "drive", label: "Google Drive Folder" },
      ],
    }],
    footerFields: [
      { key: "handed_over", label: "Laptop, mouse, pendrive and charger handed over to manager", type: "select",
        options: ["Yes", "No"], required: true, wide: true },
    ],
  },
  {
    key: "expense_claim",
    title: "Expense Tracking Form",
    heading: "EXPENSE CLAIM FORM",
    match: /expense/i,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "department", label: "Department", type: "text" },
      { key: "employee_id", label: "Employee ID", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "claim_month", label: "Claim Month", type: "text", required: true, placeholder: "e.g. October 2026" },
      { key: "date", label: "Date", type: "date", required: true },
    ],
    tables: [{
      key: "expenses", label: "Expenses", minRows: 3, totals: ["amount", "gst", "total"],
      columns: [
        { key: "date", label: "Date", type: "date", width: "11%" },
        { key: "category", label: "Category", width: "11%" },
        { key: "description", label: "Description / Purpose", width: "18%" },
        { key: "vendor", label: "Vendor", width: "11%" },
        { key: "mode", label: "Payment Mode", type: "select", options: ["Cash", "UPI", "Card", "Bank Transfer", "Company Account"], width: "10%" },
        { key: "bill_no", label: "Bill / Invoice no", width: "10%" },
        { key: "amount", label: "Amount", type: "number", width: "9%" },
        { key: "gst", label: "GST Amount", type: "number", width: "9%" },
        { key: "total", label: "Total", compute: (r) => { const t = num(r.amount) + num(r.gst); return t ? money(t) : ""; } },
      ],
    }],
    footerFields: [{ key: "advance", label: "Less: Advance Taken (if any)", type: "number" }],
    summary: (d) => {
      const rows = d.tables?.expenses ?? [];
      const total = rows.reduce((s, r) => s + num(r.amount) + num(r.gst), 0);
      return [{ label: "NET AMOUNT PAYABLE / REIMBURSABLE (INR)", value: money(total - num(d.fields?.advance)) }];
    },
    notes: [
      "Note: For every bill, attachment proof is mandatory.",
      "I hereby declare that the above expenses were incurred wholly and exclusively for official purposes and that the details furnished above are true and correct to the best of my knowledge. Original bills/invoices are attached.",
    ],
  },
  {
    key: "design_validation",
    title: "Design Validation Form",
    heading: "DESIGN VALIDATION FORM",
    match: /design\s*validation/i,
    fields: [
      { key: "project", label: "Project", type: "text", required: true },
      { key: "timeline", label: "Timeline", type: "text", placeholder: "e.g. 10 Oct – 25 Oct 2026" },
    ],
    tables: [{
      key: "checks", label: "Model verification", serial: true, minRows: 3,
      columns: [
        { key: "date", label: "Date", type: "date", width: "16%" },
        { key: "verification", label: "Model verification", width: "38%" },
        { key: "remarks", label: "Remarks", width: "28%" },
        { key: "sign", label: "Sign (name)" },
      ],
    }],
  },
  {
    key: "vendor_registration",
    title: "Vendor Registration Form",
    heading: "VENDOR REGISTRATION FORM",
    match: /vendor\s*registration/i,
    noApproval: true,
    fields: [
      { key: "supplier_name", label: "Business Name of Supplier", type: "text", required: true, wide: true },
      { key: "address", label: "Full Address", type: "textarea", required: true, wide: true },
      { key: "contact", label: "Business person's contact details (Name, designation, email, mobile)", type: "textarea", required: true, wide: true },
      { key: "expertise", label: "Core business expertise", type: "text", wide: true },
      { key: "additional_place", label: "Additional place of Business", type: "text", wide: true },
      { key: "payment_terms", label: "Terms of payment", type: "text" },
      { key: "credit_period", label: "Credit Period", type: "text", placeholder: "e.g. 30 days" },
      { key: "referred_by", label: "Referred Person name", type: "text", wide: true },
    ],
    tables: [{
      key: "checklist", label: "Checklist of Documents to be Submitted", serial: true,
      fixedRows: [
        "Company registration Proof (CIN)", "GST Certificate", "Other GST Certificate (Optional)", "Company Pan card",
        "Cancelled Cheque", "Company Address Proof", "Udyog Aadhar (MSME)", "Directors Pan card (if Available)",
        "Certificates (ISO, Dealership or if any)", "ESIC and EPFO registration details (if Available)",
        "Business Category (e.g., Packing, Interiors, Raw Materials, IT Services, Sales and Service, Manufacturing, Trading)",
        "Authorized Person contacts details",
      ].map((doc) => ({ doc, description: "", remarks: "" })),
      columns: [
        { key: "doc", label: "Document", readOnly: true, width: "40%" },
        { key: "description", label: "Description", width: "35%" },
        { key: "remarks", label: "Supplier Remarks", type: "select", options: ["Yes", "No", "Not Applicable"] },
      ],
    }],
  },
];

export function schemaForTitle(title: string): FormSchema {
  return FORM_SCHEMAS.find((s) => s.match.test(title)) ?? { ...GENERIC_SCHEMA, title };
}

export function emptyFormData(schema: FormSchema): FormData {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const fields: Record<string, string> = {};
  for (const f of [...schema.fields, ...(schema.footerFields ?? [])]) fields[f.key] = f.type === "date" ? iso : "";
  const tables: FormData["tables"] = {};
  for (const t of schema.tables ?? []) {
    if (t.fixedRows) { tables[t.key] = t.fixedRows.map((r) => ({ ...r })); continue; }
    tables[t.key] = Array.from({ length: t.minRows ?? 1 }, () => Object.fromEntries(t.columns.map((c) => [c.key, ""])));
  }
  return { fields, tables };
}

// ── Who signs ───────────────────────────────────────────────────────────────
export const APPROVER_EMAIL = "hari@triloautomation.com";
// Who approves each form (keep in sync with submit_form_request in the database):
//   Asset Submission, Expense Tracking → Anu;  Quality Check Drawing, Design Validation → Harish;  everything else → Hari
export function approverFor(title: string): { email: string; name: string } {
  if (/asset|expense/i.test(title)) return { email: "anu@triloautomation.com", name: "Anu" };
  if (/quality\s*check|design\s*validation/i.test(title)) return { email: "harishkanna@triloautomation.com", name: "Harish Kanna MK" };
  return { email: APPROVER_EMAIL, name: "Hari" };
}
/** Forms where the requester picks the approver from a dropdown (names as they start in the profile).
 *  Keep in sync with submit_form_request in the database. */
export function approverChoices(title: string): string[] | null {
  if (/quality\s*check|design\s*validation/i.test(title)) return ["Harish Kanna", "Saravanan"];
  return null;
}
/** false for forms that skip the "Approved by" step (Vendor Registration). */
export function needsApproval(title: string): boolean {
  return !schemaForTitle(title).noApproval;
}
export const AUTHORIZER_NAMES = ["Saravanan", "Jaisoorya"];

export const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Waiting for approval",
  pending_authorization: "Waiting for authorization",
  authorized: "Authorized",
  rejected: "Rejected",
};
