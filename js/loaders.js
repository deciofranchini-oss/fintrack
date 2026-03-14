import { STORE, setState } from "./store.js";

export async function loadFamilyData(){
  await Promise.all([
    loadAccountGroups(),
    loadAccounts(),
    loadCategories(),
    loadPayees(),
    loadTransactions(),
    loadBudgets(),
    loadForecast(),
    loadAssets()
  ]);
}

export async function loadAccountGroups(){
  const { data } = await sb
    .from("account_groups")
    .select("*")
    .eq("family_id", STORE.familyId)
    .order("name");
  setState("accountGroups", data || []);
}

export async function loadAccounts(){
  const { data } = await sb
    .from("accounts")
    .select("*")
    .eq("family_id", STORE.familyId)
    .order("name");
  setState("accounts", data || []);
}

export async function loadTransactions(){
  const { data } = await sb
    .from("transactions")
    .select("*")
    .eq("family_id", STORE.familyId)
    .order("date",{ascending:false});
  setState("transactions", data || []);
}