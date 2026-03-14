import { STORE, resetFamilyState } from "./store.js";
import { loadFamilyData } from "./loaders.js";

export async function switchFamily(familyId){

  showFamilyLoading();

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