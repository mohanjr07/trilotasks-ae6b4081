// ─────────────────────────────────────────────────────────────────────────────
//  Project names are shown only to admins, Anu, Aiswarya, Harish and Thiyanesh.
//  Everyone else sees the project number in place of the name — everywhere in
//  the app — because every "projects" result from Supabase passes through
//  maskProjectNames() below. (TRILO_project_numbers.sql)
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";

export const PROJECT_NAME_EMAILS = [
  "anu@triloautomation.com", "anuvenkatachalam14@gmail.com",
  "harishkanna@triloautomation.com", "harishkaanna@triloautomation.com",
  "aiswarya.v@triloautomation.com", "thiyanesh@triloautomation.com",
];

export function canSeeProjectNames(profile?: { role?: string | null; email?: string | null } | null): boolean {
  if (!profile) return false;
  return ["admin", "super_admin"].includes(profile.role ?? "") || PROJECT_NAME_EMAILS.includes((profile.email ?? "").toLowerCase());
}

/** What people who can't see names see. */
export const projectNumberLabel = (num?: string | null, sub?: string | null) => {
  const n = (num && String(num).trim()) || "";
  const s = (sub && String(sub).trim()) || "";
  return n ? (s ? `${n} / ${s}` : n) : "Project (no number)";
};

let showNames = false;
/** Set from the layout once the signed-in profile is known; returns true if it changed. */
export function setProjectNameAccess(value: boolean): boolean {
  const changed = value !== showNames;
  showNames = value;
  return changed;
}
export const projectNamesVisible = () => showNames;

const PROJECTS_PATH = /\/rest\/v1\/projects$/;
const FORM_NAMES_PATH = /\/rest\/v1\/rpc\/form_project_names$/;

function maskRow(row: any) {
  if (row && typeof row === "object" && "name" in row) row.name = projectNumberLabel(row.project_number, row.sub_project_number);
}

/** Every Supabase request goes through here: hide project names for people who can't see them. */
export function installProjectNameMask() {
  try {
    let proto: any = Object.getPrototypeOf(supabase.from("projects").select("id"));
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "then")) proto = Object.getPrototypeOf(proto);
    if (!proto || proto.__projectMask) return;
    const origThen = proto.then;
    proto.__projectMask = true;
    proto.then = function (this: any, onF?: any, onR?: any) {
      const self = this;
      const run = () => origThen.call(self, (x: any) => x);
      const url: URL | undefined = self?.url instanceof URL ? self.url : undefined;
      if (showNames || !url) return run().then(onF, onR);

      const path = url.pathname;
      const select = url.searchParams.get("select");
      // embeds like  project:projects(name, color)  → which keys to mask
      const embedKeys: string[] = [];
      let newSelect = select;
      if (select) {
        if (PROJECTS_PATH.test(path) && select !== "*" && !/(^|,)\s*project_number\b/.test(select)) newSelect = select + ",project_number,sub_project_number";
        newSelect = (newSelect ?? "").replace(/(?:(\w+):)?projects(!\w+)?\(([^)]*)\)/g, (m, alias, hint, cols) => {
          embedKeys.push(alias || "projects");
          return cols.trim() === "*" || /\bproject_number\b/.test(cols) ? m : `${alias ? alias + ":" : ""}projects${hint ?? ""}(${cols},project_number,sub_project_number)`;
        });
        if (newSelect !== select) url.searchParams.set("select", newSelect!);
      }
      const isProjects = PROJECTS_PATH.test(path);
      const isFormNames = FORM_NAMES_PATH.test(path);

      return run()
        .then((res: any) => {
          // database not updated yet (no project_number column) → ask again the old way
          if (res?.error && /project_number/.test(res.error.message ?? "") && select) {
            url.searchParams.set("select", select);
            return run();
          }
          return res;
        })
        .then((res: any) => {
          try {
            if (res && !res.error && res.data) {
              const rows = Array.isArray(res.data) ? res.data : [res.data];
              if (isProjects) rows.forEach(maskRow);
              if (embedKeys.length) rows.forEach((r: any) => embedKeys.forEach((k) => {
                const v = r?.[k];
                if (Array.isArray(v)) v.forEach(maskRow); else maskRow(v);
              }));
              if (isFormNames) res = { ...res, data: null, error: { message: "masked" } };   // → uses the (masked) projects list
            }
          } catch { /* never break a request because of masking */ }
          return res;
        })
        .then(onF, onR);
    };
  } catch { /* masking unavailable — leave requests untouched */ }
}
