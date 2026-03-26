// User needs to configure their EmailJS credentials
/* ═══════════════════════════════════════════════════════════════
   EMAILJS CONFIGURATION
═══════════════════════════════════════════════════════════════ */
const EMAILJS_CONFIG = {
  serviceId:  'service_8e4rkde',
  templateId: 'template_fla7gdi',
  scheduledTemplateId: 'template_yfmczq7',
  publicKey:  'wwnXjEFDaVY7K-qIjwX0H',
};

/* ═══════════════════════════════════════════════════════════════
   APP SETTINGS — stored in app_settings table (Supabase)
   Falls back to localStorage for backward compatibility
═══════════════════════════════════════════════════════════════ */


// === PERIODICITY COLORS ===
function getPeriodColor(period) {
  switch((period||'').toLowerCase()) {
    case 'daily': return '#2ecc71';
    case 'weekly': return '#3498db';
    case 'monthly': return '#f39c12';
    case 'yearly': return '#9b59b6';
    default: return '#1F6B4F';
  }
}
