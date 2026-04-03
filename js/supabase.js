/* Supabase bootstrap (global) - Family FinTrack
   - Provides global `sb` client (window.sb)
   - Provides tryAutoConnect() used by auth/app modules
   - Compatible with GitHub Pages (no modules/imports)
*/
(function(){
  // Resolve config: prefer embedded window constants, fallback to localStorage bundle
  function getCfg(){
    const fromWindow = {
      url: (window.SUPABASE_URL || '').trim(),
      anon: (window.SUPABASE_ANON_KEY || '').trim()
    };
    if(fromWindow.url && fromWindow.anon) return fromWindow;

    try{
      const raw = localStorage.getItem('fintrack_supabase_config');
      if(raw){
        const j = JSON.parse(raw);
        const url = (j.url || j.SUPABASE_URL || '').trim();
        const anon = (j.anon || j.key || j.SUPABASE_ANON_KEY || '').trim();
        if(url && anon) return { url, anon };
      }
    }catch(e){}
    return { url:'', anon:'' };
  }

  function ensureClient(){
    const cfg = getCfg();
    if(!cfg.url || !cfg.anon){
      window.sb = window.sb || null;
      return null;
    }
    // supabase global from CDN: window.supabase
    if(!window.supabase || typeof window.supabase.createClient !== 'function'){
      console.error('[Supabase] supabase-js not loaded');
      return null;
    }
    if(window.sb && window.__SB_URL === cfg.url) return window.sb;

    const client = window.supabase.createClient(cfg.url, cfg.anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    window.sb = client;
    window.__SB_URL = cfg.url;
    return client;
  }

  async function tryAutoConnect(){
    const client = ensureClient();
    if(!client) return false;
    try{
      const { data } = await client.auth.getSession();
      window.__ftSession = data ? data.session : null;
      return true;
    }catch(e){
      console.warn('[Supabase] tryAutoConnect failed:', e && e.message ? e.message : e);
      return false;
    }
  }

  // expose
  window.tryAutoConnect = tryAutoConnect;
  window.ensureSupabaseClient = ensureClient;

  // eager attempt (non-blocking)
  tryAutoConnect();
})();
