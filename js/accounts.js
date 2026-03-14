
import { STORE, subscribe } from "./store.js";

subscribe(state => renderAccounts(state.accounts, state.accountGroups));

function renderAccounts(accounts, groups){

  const container = document.querySelector("#accounts-list");
  if(!container) return;

  container.innerHTML = "";

  accounts.forEach(acc=>{

    const group = groups?.find(g=>g.id === acc.group_id);

    const row = document.createElement("div");
    row.className = "account-row";

    row.innerHTML = `
      <div class="account-name">${acc.name}</div>
      <div class="account-group">${group ? group.name : ""}</div>
      <div class="account-balance">${acc.balance}</div>
    `;

    container.appendChild(row);

  });

}
