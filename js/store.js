const listeners = [];

export const STORE = {
  familyId: null,
  accounts: [],
  accountGroups: [],
  categories: [],
  payees: [],
  transactions: [],
  budgets: [],
  forecast: [],
  assets: [],
  grocery: [],
  prices: []
};

export function setState(key, value){
  STORE[key] = value;
  notify();
}

export function resetFamilyState(){
  STORE.accounts = [];
  STORE.accountGroups = [];
  STORE.categories = [];
  STORE.payees = [];
  STORE.transactions = [];
  STORE.budgets = [];
  STORE.forecast = [];
  STORE.assets = [];
  STORE.grocery = [];
  STORE.prices = [];
  notify();
}

function notify(){
  listeners.forEach(fn => fn(STORE));
}

export function subscribe(fn){
  listeners.push(fn);
}