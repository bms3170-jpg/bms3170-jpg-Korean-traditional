const SUPABASE_URL = "https://njsfqygtnpytogiylzor.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TZ-zoIkPaggGvio4m5dYbw_Ts12INmv";
window.supabaseConfigured = !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
if (window.supabaseConfigured && window.supabase) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
