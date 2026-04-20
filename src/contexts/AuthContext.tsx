import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "intern";
  department: string | null;
  position: string | null;
  avatar_url: string | null;
  phone: string | null;
  is_active: boolean;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    setProfile((data as Profile | null) ?? null);
  };

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (nextSession: Session | null, showLoading = false) => {
      if (!isMounted) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        setProfile(null);
        setLoading(false);
        initialLoadDone.current = true;
        return;
      }

      if (showLoading) setLoading(true);

      try {
        await fetchProfile(nextSession.user.id);
      } catch {
        if (isMounted) {
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          initialLoadDone.current = true;
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Only ignore passive background events that don't represent real auth changes
      if (
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) return;

      // INITIAL_SESSION is handled by getSession() below — skip to avoid double-fetch
      if (event === "INITIAL_SESSION") return;

      // SIGNED_IN and SIGNED_OUT must always sync (this is what was broken)
      void syncAuthState(nextSession, false);
    });

    // Initial load — fetch session once on mount
    void supabase.auth.getSession().then(({ data: { session: nextSession } }) =>
      syncAuthState(nextSession, true)
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (session?.user) await fetchProfile(session.user.id);
  };

  const isAdmin = profile?.role === "admin" || profile?.role === "manager";

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signIn, signOut, isAdmin, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
