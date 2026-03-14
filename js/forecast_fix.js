
/* Prevent duplicated scheduled icon rendering */

function renderForecastItem(item){

  const icon = item.is_scheduled ? "⏰" : "";

  return `
    <div class="forecast-row">
      <div class="forecast-desc">
        <div class="forecast-title">${item.description || ""}</div>
        <div class="forecast-category">${item.category || ""}</div>
        <div class="forecast-meta">${item.payee || ""}</div>
      </div>
      <div class="forecast-icon">${icon}</div>
      <div class="forecast-amount">${item.amount}</div>
    </div>
  `;

}
