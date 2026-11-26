// ─────────────────────────────────────────────────────────────────────────────
//  Payslips are switched on for everyone only when app_flags.payslips_live is true
//  (TRILO_payslips_hidden.sql). Until then only Anu sees the Payslips section,
//  so she can prepare the slips. The database enforces the same rule.
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PAYROLL_EDITOR_EMAIL = "anu@triloautomation.com";

export function usePayslipsLive() {
  return useQuery({
    queryKey: ["app-flag", "payslips_live"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("app_flags").select("enabled").eq("key", "payslips_live").maybeSingle();
      if (error) return false;              // not set up yet → hidden
      return !!data?.enabled;
    },
  });
}

/** Can this person see the Payslips section right now? */
export function useCanSeePayslips(email?: string | null) {
  const { data: live = false, isLoading } = usePayslipsLive();
  const isEditor = (email ?? "").toLowerCase() === PAYROLL_EDITOR_EMAIL;
  return { allowed: isEditor || live, isLoading: !isEditor && isLoading };
}
