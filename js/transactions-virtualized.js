
import { STORE, subscribe } from "./store.js";

const ROW_HEIGHT = 56;
const BUFFER = 10;

subscribe(state => {
  initVirtualList(state.transactions || []);
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

function initVirtualList(transactions){

  const container = document.querySelector("#transactions-list");
  if(!container) return;

  const viewportHeight = container.clientHeight || 600;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + BUFFER;

  const openingBalance = 0;
  const balances = computeRunningBalance(transactions, openingBalance);

  container.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.style.height = (transactions.length * ROW_HEIGHT) + "px";
  container.appendChild(spacer);

  const layer = document.createElement("div");
  layer.className = "tx-virtual-layer";
  container.appendChild(layer);

  container.onscroll = () => {

    const scrollTop = container.scrollTop;
    const start = Math.floor(scrollTop / ROW_HEIGHT);
    const end = start + visibleCount;

    layer.innerHTML = "";

    const slice = transactions.slice(start,end);

    slice.forEach((tx,i)=>{

      const row = document.createElement("div");
      row.className = "tx-row";

      row.style.top = ((start+i)*ROW_HEIGHT)+"px";

      row.innerHTML = `
        <div class="tx-desc">
          <div class="tx-title">${tx.description || ""}</div>
          <div class="tx-category">${tx.category || ""}</div>
          <div class="tx-meta">${tx.payee || ""}</div>
        </div>
        <div class="tx-amount">${tx.amount}</div>
        <div class="tx-balance">${balances[tx.id]}</div>
      `;

      layer.appendChild(row);

    });

  };

}
