// How many things are waiting for ME in each section — shown as red number badges in the menu.
// Refreshes live (LiveSync invalidates every query when the database changes).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const PAYER_EMAIL = "anu@triloautomation.com";
const OT_APPROVER_EMAIL = "hari@triloautomation.com";

async function count(build: (q: any) => any): Promise<number> {
  try {
    const { count: n, error } = await build((supabase as any)) ;
    return error ? 0 : n ?? 0;
  } catch {
    return 0;
  }
}

export function usePendingCounts(): Record<string, number> {
  const { user, profile } = useAuth();
  const me = user?.id;
  const email = (profile?.email ?? "").toLowerCase();
  const role = profile?.role ?? "";

  const { data } = useQuery({
    queryKey: ["pending-counts", me, role, email],
    enabled: !!me,
    queryFn: async () => {
      const head = { count: "exact", head: true } as const;
      const [forms, payVerify, payApprove, payToPay, ot, leave] = await Promise.all([
        // forms waiting for my approval or my authorization
        count((s) => s.from("form_requests").select("id", head)
          .or(`and(approver_id.eq.${me},status.eq.pending_approval),and(authorizer_id.eq.${me},status.eq.pending_authorization)`)),
        // payments: bills I have to verify
        count((s) => s.from("payment_requests").select("id", head).eq("verifier_id", me).eq("status", "pending_verification")),
        // admins: payments waiting for approval
        role === "admin" ? count((s) => s.from("payment_requests").select("id", head).eq("status", "pending")) : Promise.resolve(0),
        // Anu: approved payments still to pay
        email === PAYER_EMAIL ? count((s) => s.from("payment_requests").select("id", head).eq("status", "approved").is("paid_at", null)) : Promise.resolve(0),
        // Hari: overtime waiting for his approval
        email === OT_APPROVER_EMAIL ? count((s) => s.from("overtime_entries").select("id", head).is("verified_at", null)) : Promise.resolve(0),
        // admins / managers: leave requests waiting
        role === "admin" || role === "manager" ? count((s) => s.from("leave_requests").select("id", head).eq("status", "pending")) : Promise.resolve(0),
      ]);
      return {
        "/form-requests": forms,
        "/payments": payVerify + payApprove + payToPay,
        "/overtime": ot,
        "/leave": leave,
      } as Record<string, number>;
    },
  });
  return data ?? {};
}
