// Legacy shim: payee autocomplete now lives in utils.js
// Keep this file loaded for backward compatibility without redeclaring globals.
(function(){
  try {
    if (typeof window !== 'undefined') {
      window.__payeeAutocompleteShimLoaded = true;
    }
  } catch (_) {}
})();
