(function (global) {
  function getUserLocale() {
    return document?.documentElement?.lang || navigator.language || 'pt-BR';
  }

  function toDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput instanceof Date) return new Date(dateInput.getTime());
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return new Date(dateInput + 'T12:00:00');
    }
    const d = new Date(dateInput);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatUserDate(dateInput, options = {}) {
    const date = toDate(dateInput);
    if (!date) return '';
    return new Intl.DateTimeFormat(getUserLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...options,
    }).format(date);
  }

  function formatUserDateTime(dateInput, options = {}) {
    const date = toDate(dateInput);
    if (!date) return '';
    return new Intl.DateTimeFormat(getUserLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(date);
  }

  function formatMonthYear(dateInput = new Date(), options = {}) {
    const date = toDate(dateInput) || new Date();
    return new Intl.DateTimeFormat(getUserLocale(), {
      month: 'long',
      year: 'numeric',
      ...options,
    }).format(date);
  }

  function getTodayLocalISO() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  global.FinTrackDateUtils = {
    getUserLocale,
    formatUserDate,
    formatUserDateTime,
    formatMonthYear,
    getTodayLocalISO,
  };
})(window);
