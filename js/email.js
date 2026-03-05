// User needs to configure their EmailJS credentials
/* ═══════════════════════════════════════════════════════════════
   EMAILJS CONFIGURATION
═══════════════════════════════════════════════════════════════ */
const EMAILJS_CONFIG = {
  serviceId:  '',
  templateId: '',
  publicKey:  '',
};

/* ═══════════════════════════════════════════════════════════════
   APP SETTINGS — stored in app_settings table (Supabase)
   Falls back to localStorage for backward compatibility
═══════════════════════════════════════════════════════════════ */
