import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTHORIZER_NAMES } from "@/lib/formSchemas";

type Person = { id: string; full_name: string; role?: string };

/** Everyone's names (for the signature block) + the two authorizer choices. */
export function useFormPeople() {
  const { data: people = [] } = useQuery({
    queryKey: ["form-people"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_profiles");
      if (error) throw error;
      return (data ?? []) as Person[];
    },
    staleTime: 5 * 60 * 1000,
  });
  const names: Record<string, string> = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
  const authorizers = AUTHORIZER_NAMES
    .map((n) => people.find((p) => p.full_name?.trim().toLowerCase().startsWith(n.toLowerCase())))
    .filter((p): p is Person => !!p);
  // exact name first, then first name, then "starts with" (so "Hari" never picks "Harish")
  const findName = (n: string) => {
    const k = n.trim().toLowerCase();
    const nm = (p: Person) => (p.full_name ?? "").trim().toLowerCase();
    return people.find((p) => nm(p) === k) ?? people.find((p) => nm(p).split(/\s+/)[0] === k)
      ?? people.find((p) => nm(p).startsWith(k));
  };
  const byNames = (list: string[]) => list.map(findName).filter((p): p is Person => !!p);
  const managers = people.filter((p) => p.role === "manager")
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  return { people, names, authorizers, byNames, managers };
}
