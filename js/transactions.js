import { STORE, subscribe } from "./store.js";

subscribe(state => {
  renderTransactions(state.transactions);
});

function computeRunningBalance(transactions, openingBalance){

  const sorted = [...transactions].sort(
    (a,b)=> new Date(a.date) - new Date(b.date)
  );

  let balance = openingBalance || 0;

  const map = {};

  for(const tx of sorted){
    balance += Number(tx.amount);
    map[tx.id] = balance;
  }

  return map;
}

function renderTransactions(transactions){

  const container = document.querySelector("#transactions-list");
  if(!container) return;

  container.innerHTML = "";

  const openingBalance = 0;

  const balances = computeRunningBalance(transactions, openingBalance);

  transactions.forEach(tx=>{

    const row = document.createElement("div");
    row.className = "tx-row";

    row.innerHTML = `
      <div class="tx-desc">
        <div class="tx-title">${tx.description || ""}</div>
        <div class="tx-category">${tx.category || ""}</div>
        <div class="tx-meta">${tx.payee || ""}</div>
      </div>
      <div class="tx-amount">${tx.amount}</div>
      <div class="tx-balance">${balances[tx.id]}</div>
    `;

    container.appendChild(row);

  });
}