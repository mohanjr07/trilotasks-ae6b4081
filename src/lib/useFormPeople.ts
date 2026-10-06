import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTHORIZER_NAMES } from "@/lib/formSchemas";

type Person = { id: string; full_name: string };

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
  return { people, names, authorizers };
}
