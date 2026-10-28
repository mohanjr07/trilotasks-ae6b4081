// Subproject of a payment request (under the project). Keep in sync with
// payment_requests_sub_project_check in the database.
export const SUB_PROJECTS = [
  { key: "electrical", label: "Electrical" },
  { key: "mechanical", label: "Mechanical" },
  { key: "consumables", label: "Consumables" },
  { key: "internal_transport", label: "Internal Transport" },
  { key: "external_transport", label: "External Transport" },
] as const;
export type SubProject = (typeof SUB_PROJECTS)[number]["key"];
export const subProjectLabel = (k?: string | null) => (k ? SUB_PROJECTS.find((s) => s.key === k)?.label ?? k : "");
