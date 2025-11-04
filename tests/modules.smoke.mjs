import assert from 'assert';

const noop = () => {};
const classList = { add: noop, remove: noop, toggle: noop };
const elem = () => ({ append: noop, prepend: noop, addEventListener: noop, remove: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, getAttribute: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, innerHTML:'', textContent:'', value:'', focus: noop });
const documentStub = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: elem,
  createTextNode: () => ({}),
  body: { append: noop, prepend: noop, appendChild: noop, classList, innerHTML:'', style:{} },
  head: { appendChild: noop, querySelector: () => null },
  addEventListener: noop,
  cookie: ''
};
const localStorageStub = { _s:new Map(), getItem(k){ return this._s.get(k) || null; }, setItem(k,v){ this._s.set(k,v); }, removeItem(k){ this._s.delete(k); } };
const fetchStub = async (url, opts={}) => ({ ok:true, status:200, json: async()=>({}), text: async()=>'' });
const windowStub = { document: documentStub, localStorage: localStorageStub, location:{ href:'', assign:noop, replace:noop }, addEventListener:noop, removeEventListener:noop, API_BASE_URL:'', navigator:{ onLine:true, serviceWorker:{ register:async()=>({}) } } };
const navigatorStub = windowStub.navigator;
Object.defineProperty(global, 'window', { value: windowStub });
Object.defineProperty(global, 'document', { value: documentStub });
Object.defineProperty(global, 'localStorage', { value: localStorageStub });
Object.defineProperty(global, 'fetch', { value: fetchStub });
Object.defineProperty(global, 'navigator', { value: navigatorStub });
Object.defineProperty(global, 'alert', { value: noop });
Object.defineProperty(global, 'confirm', { value: noop });
Object.defineProperty(global, 'prompt', { value: noop });
window.fetch = fetchStub; window.alert = noop; window.confirm = noop; window.prompt = noop;

const modules = [
  '../0_login.js',
  '../modules/api.js',
  '../modules/store.js',
  '../modules/1_sessiebeheer.js',
  '../modules/3_data.js',
  '../modules/4_ui.js',
  '../modules/5_eventbeheer.js',
  '../modules/6_beheerVoorraad.js',
  '../modules/7_beheerProducten.js',
  '../modules/8_verkoopscherm.js',
  '../modules/9_eventdetails.js',
  '../modules/11_gebruikersbeheer.js',
  '../modules/13_email.js',
  '../modules/14_reisPlanning.js',
  '../modules/15_eventSchedule.js',
  '../modules/17_inzichten.js',
  '../modules/autoRefresh.js',
  '../modules/disableRefresh.js',
  '../modules/voorraad_utils.js'
];

let count = 0;
for (const m of modules) {
  const mod = await import(m);
  assert.ok(mod, `module ${m} loaded`);
  count++;
}
console.log(`Loaded ${count} modules successfully.`);
