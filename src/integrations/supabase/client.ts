import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';
import { isNativeApp, PUBLIC_SITE } from '@/lib/platform';

// Indian ISPs block *.supabase.co, so on the website we go through our own
// domain (/sb is relayed to Supabase by functions/sb/[[path]].js on Cloudflare).
// The Android app also goes through the website's /sb relay.
const onWebsite =
  typeof window !== "undefined" &&
  window.location.protocol === "https:" &&
  !(window as any).IS_ELECTRON &&
  !isNativeApp;
const SUPABASE_URL = isNativeApp
  ? `${PUBLIC_SITE}/sb`
  : onWebsite
  ? `${window.location.origin}/sb`
  : import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  }
});