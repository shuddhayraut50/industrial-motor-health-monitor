import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || '';

/**
 * Creates an admin Supabase client using the service role secret key.
 * Used exclusively on the server for telemetry ingestion and device status updates.
 * NEVER expose this client to the browser.
 */
export function getAdminClient() {
  if (!supabaseUrl || !supabaseSecretKey || supabaseUrl.includes('placeholder')) {
    return null;
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
