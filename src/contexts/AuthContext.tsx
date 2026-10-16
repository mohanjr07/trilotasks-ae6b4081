import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { removePushToken } from "@/lib/push";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "intern" | "super_admin";
  manager_id: string | null;
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

  // The profile is cached on the device, so a slow or dropped connection (very common when the
  // iPhone home-screen app wakes up) never looks like being logged out.
  const PROFILE_CACHE = "taskflow-profile";
  const readCachedProfile = (userId: string): Profile | null => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? "null");
      return p && p.id === userId ? (p as Profile) : null;
    } catch { return null; }
  };
  const fetchProfile = async (userId: string) => {
    let lastError: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (!error) {
        setProfile((data as Profile | null) ?? null);
        try {
          if (data) localStorage.setItem(PROFILE_CACHE, JSON.stringify(data));
          else localStorage.removeItem(PROFILE_CACHE);
        } catch { /* ignore */ }
        return;
      }
      lastError = error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    // still offline: keep using the copy saved on this device
    const cached = readCachedProfile(userId);
    if (cached) { setProfile(cached); return; }
    throw lastError;
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
      // show the saved profile straight away; the fresh one replaces it a moment later
      const cached = readCachedProfile(nextSession.user.id);
      if (cached) { setProfile(cached); setLoading(false); }

      try {
        await fetchProfile(nextSession.user.id);
      } catch {
        // couldn't load it and nothing saved — leave the session alone (never log out over a network blip);
        // it is fetched again when the app comes back to the front or the connection returns
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

    // app back in front / connection back: make sure the session is fresh and the profile is loaded
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data: { session: s } }) => {
        if (!isMounted || !s?.user) return;
        setSession(s);
        fetchProfile(s.user.id).catch(() => {});
      });
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await removePushToken().catch(() => {});
    await supabase.auth.signOut();
    try { localStorage.removeItem(PROFILE_CACHE); } catch { /* ignore */ }
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
