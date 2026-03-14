
import { STORE, resetFamilyState } from "./store.js";
import { loadFamilyData } from "./loaders.js";

function clearUI(){

  const sections = [
    "#accounts-list",
    "#transactions-list",
    "#forecastAccountsContainer",
    "#budgets-list",
    "#reports-container",
    "#grocery-list",
    "#prices-list"
  ];

  sections.forEach(sel=>{
    const el = document.querySelector(sel);
    if(el) el.innerHTML = "";
  });

}

export async function switchFamily(familyId){

  showFamilyLoading();

  clearUI();

  resetFamilyState();

  STORE.familyId = familyId;

  await loadFamilyData();

  hideFamilyLoading();
}

export function showFamilyLoading(){

  document.body.classList.add("family-switching");

  const overlay = document.createElement("div");
  overlay.className = "family-loading-overlay";
  overlay.id = "family-loading";

  document.body.appendChild(overlay);
}

export function hideFamilyLoading(){

  document.body.classList.remove("family-switching");

  const el = document.getElementById("family-loading");
  if(el) el.remove();
}
