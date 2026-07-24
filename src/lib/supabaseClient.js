import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Make sure these are set correctly
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables!");
  console.log("SUPABASE_URL:", supabaseUrl ? "Set" : "Missing");
  console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "Set" : "Missing");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);