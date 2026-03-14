
import { STORE, setState } from "./store.js";

export async function loadTransactions(){

  const { data } = await sb
    .from("transactions")
    .select("*")
    .eq("family_id", STORE.familyId)
    .order("date",{ascending:false})
    .limit(5000);

  setState("transactions", data || []);
}
