// A browser-only stand-in for Supabase, used by the demo (/demo/).
// It answers the same query calls the app makes, keeps everything in localStorage,
// applies the same admin / member rules as supabase/schema.sql, and wipes itself after an hour.
import { today, addDays, calc } from './lib.js';

const KEY = 'invoicedesk.demo';
const TTL = 60 * 60 * 1000;
const USERS = {
  admin: { id: 'demo-admin', email: 'asha@demo.invoicedesk.app', user_metadata: { name: 'Asha Sharma' } },
  member: { id: 'demo-member', email: 'ravi@demo.invoicedesk.app', user_metadata: { name: 'Ravi Kumar' } }
};
const uuid = () => crypto.randomUUID();
const stamp = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const clone = v => JSON.parse(JSON.stringify(v));

// ---------- sample business ----------
function seed() {
  const d = n => addDays(today(), n);
  const B = uuid();
  const cust = (name, email, phone, address, tax_id = '') => ({ id: uuid(), business_id: B, name, email, phone, address, tax_id, notes: '', created_by: 'demo-admin', created_at: stamp(90) });
  const customers = [
    cust('Acme Retail Pvt Ltd', 'accounts@acme.example', '+91 99887 76655', '45 Park Street\nKolkata 700016', '19AAACA1234B1Z2'),
    cust('Bluebird Cafe', 'owner@bluebird.example', '+91 98111 22334', '8 FC Road, Pune 411004'),
    cust('Northwind LLC', 'ap@northwind.example', '+1 512 555 0142', '200 Main St\nAustin, TX 78701, USA'),
    cust('Kumar & Co', 'hello@kumarco.example', '+91 90000 12345', '21 Brigade Road\nBengaluru 560001', '29AABCK5678L1Z9')
  ];
  const [acme, bluebird, northwind, kumar] = customers;
  const item = (name, price, unit, description = '') => ({ id: uuid(), business_id: B, name, description, price, unit, created_at: stamp(90) });
  const items = [item('Logo design', 15000, 'project', '3 concepts, 2 revisions'), item('Website design (per page)', 8000, 'page'),
    item('Social media post', 1200, 'post'), item('Brand guidelines', 25000, 'project')];
  const pm = (type, label, value, is_default) => ({ id: uuid(), business_id: B, type, label, value, qr_image: null, is_default, created_at: stamp(90) });
  const methods = [pm('upi', 'UPI', 'sharmadesign@okhdfc', true),
    pm('bank', 'Bank transfer', 'Sharma Design Studio\nA/c 50100234567890\nIFSC HDFC0001234\nHDFC Bank, Pune', true),
    pm('zelle', 'Zelle', 'pay@sharmadesign.example', false)];
  const usd = [methods[2].id];
  const inr = [methods[0].id, methods[1].id];

  const from = 'Sharma Design Studio\n12 MG Road, Pune 411001\n+91 98765 43210 · hello@sharmadesign.example\nGSTIN 27ABCDE1234F1Z5';
  const invoices = [], payments = [];
  const inv = (n, c, issued, dueIn, lines, { currency = 'INR', tax = 18, by = 'demo-admin', paid = [] } = {}) => {
    const i = {
      id: uuid(), business_id: B, number: `INV-${n}`, title: 'INVOICE', customer_id: c.id, from_text: from,
      bill_to: [c.name, c.address, c.email].join('\n'), ship_to: '', issue_date: d(issued), due_date: d(issued + dueIn),
      payment_terms: `Net ${dueIn}`, po_number: '', currency, paper: 'A4',
      items: lines.map(([desc, qty, rate]) => ({ item_id: items.find(x => x.name === desc)?.id || null, desc, qty, rate })),
      discount: { on: false, type: '%', value: '' }, tax: { on: tax > 0, type: '%', value: tax || '', label: 'GST' },
      shipping: { on: false, value: '' }, notes: 'Thank you for your business!', terms: '',
      payment_method_ids: currency === 'USD' ? usd : inr, created_by: by, updated_by: by,
      created_at: stamp(-issued), updated_at: stamp(-issued)
    };
    const t = calc(i);
    i.subtotal = t.subtotal; i.total = t.total;
    invoices.push(i);
    for (const [daysAfter, amount, method, reference = ''] of paid) {
      payments.push({ id: uuid(), business_id: B, invoice_id: i.id, amount: amount === 'all' ? t.total : amount,
        paid_on: d(issued + daysAfter), method, reference, note: '', created_by: by, created_at: stamp(-(issued + daysAfter)) });
    }
  };
  inv(1, acme, -80, 15, [['Logo design', 1, 15000], ['Social media post', 10, 1200]], { paid: [[13, 'all', 'Bank transfer', 'NEFT N2026041']] });
  inv(2, northwind, -64, 15, [['Brand guidelines', 1, 1800]], { currency: 'USD', tax: 0, paid: [[9, 'all', 'Zelle']] });
  inv(3, bluebird, -50, 15, [['Website design (per page)', 3, 8000]], { paid: [[10, 10000, 'UPI', 'UTR 412345678901']] });
  inv(4, kumar, -33, 15, [['Logo design', 1, 14000], ['Website design (per page)', 5, 8000]], { by: 'demo-member', paid: [[20, 'all', 'Cheque', 'CHQ 004512']] });
  inv(5, acme, -20, 15, [['Social media post', 20, 1100]]);
  inv(6, bluebird, -6, 15, [['Social media post', 8, 1200]], { by: 'demo-member', paid: [[2, 5000, 'Cash']] });
  inv(7, kumar, -1, 15, [['Brand guidelines', 1, 25000]]);

  const member = (u, role) => ({ business_id: B, user_id: u.id, email: u.email, name: u.user_metadata.name, role, created_at: stamp(90) });
  return {
    created: Date.now(),
    as: 'admin',
    tables: {
      businesses: [{
        id: B, name: 'Sharma Design Studio', next_number: 8, member_can_edit: false, show_payment_when_paid: false, created_at: stamp(90),
        settings: { from, currency: 'INR', paper: 'A4', title: 'INVOICE', prefix: 'INV-', due_days: 15, tax_label: 'GST', tax_rate: 18,
          notes: 'Thank you for your business!', terms: '', logo: null }
      }],
      members: [member(USERS.admin, 'admin'), member(USERS.member, 'member')],
      invites: [], customers, items, payment_methods: methods, invoices, payments
    }
  };
}

// ---------- storage ----------
let state;
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: lives in memory only */ } }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.tables && Date.now() - s.created < TTL) return s;
  } catch { /* fall through to a fresh demo */ }
  return null;
}
state = load();
// a fresh demo has none of the records an old link points to
export const demoIsNew = !state;
state ||= seed();
save();

export const demoExpiresAt = () => state.created + TTL;
export function resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
export function switchDemoUser(as) { state.as = as; save(); }
const user = () => USERS[state.as];

// ---------- the same rules as the database ----------
const biz = () => state.tables.businesses[0];
const role = () => state.tables.members.find(m => m.user_id === user().id)?.role;
function allowed(table, op) {
  if (op === 'select') return true;
  const admin = role() === 'admin';
  switch (table) {
    case 'customers': case 'items': return op === 'delete' ? admin : true;
    case 'invoices': return op === 'insert' || admin || (op === 'update' && biz().member_can_edit);
    case 'payments': return op === 'insert' || admin;
    default: return admin;  // payment methods, business settings, team, invites
  }
}
const fail = (code, message) => Object.assign(new Error(message), { code });

function beforeInsert(table, row) {
  const r = { id: uuid(), created_at: new Date().toISOString(), ...clone(row) };
  if (table === 'invoices') {
    if (state.tables.invoices.some(i => i.number === r.number)) throw fail('23505', 'duplicate invoice number');
    Object.assign(r, { created_by: user().id, updated_by: user().id, updated_at: r.created_at });
  }
  if (table === 'payments' || table === 'customers') r.created_by = user().id;
  if (table === 'payments') r.amount = Number(r.amount);
  return r;
}

class Query {
  constructor(table) { Object.assign(this, { table, op: 'select', filters: [], sort: null, slice: null, want: false, one: null }); }
  select(cols = '*') { if (this.op === 'select') this.embed = /businesses\(\*\)/.test(cols); else this.want = true; return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  upsert(rows) { return this.insert(rows); }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.filters.push([k, v]); return this; }
  order(k, { ascending = true } = {}) { this.sort = [k, ascending]; return this; }
  range(a, b) { this.slice = [a, b + 1]; return this; }
  limit(n) { this.slice = [0, n]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }

  run() {
    try {
      const T = state.tables, rows = (T[this.table] ??= []);
      const match = r => this.filters.every(([k, v]) => r[k] === v);
      let out;
      if (this.op === 'select') {
        out = rows.filter(match);
        if (this.sort) {
          const [k, asc] = this.sort;
          out = [...out].sort((a, b) => (String(a[k] ?? '') < String(b[k] ?? '') ? -1 : String(a[k] ?? '') > String(b[k] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        }
        if (this.slice) out = out.slice(...this.slice);
        out = clone(out);
        if (this.embed) out.forEach(r => { r.businesses = clone(T.businesses.find(b => b.id === r.business_id)); });
      } else if (this.op === 'insert') {
        if (!allowed(this.table, 'insert')) throw fail('42501', 'new row violates row-level security policy');
        out = [].concat(this.payload).map(r => beforeInsert(this.table, r));
        rows.push(...out);
      } else if (this.op === 'update') {
        out = allowed(this.table, 'update') ? rows.filter(match) : [];
        if (this.table === 'invoices' && 'number' in this.payload
          && rows.some(i => i.number === this.payload.number && !out.includes(i))) throw fail('23505', 'duplicate invoice number');
        for (const r of out) {
          Object.assign(r, clone(this.payload));
          if (this.table === 'invoices') Object.assign(r, { updated_by: user().id, updated_at: new Date().toISOString() });
        }
        if (this.table === 'members' && !T.members.some(m => m.role === 'admin')) {
          out.forEach(r => { r.role = 'admin'; });
          throw fail('P0001', 'A business needs at least one admin');
        }
      } else if (this.op === 'delete') {
        out = allowed(this.table, 'delete') ? rows.filter(match) : [];
        T[this.table] = rows.filter(r => !out.includes(r));
        const gone = new Set(out.map(r => r.id));
        if (this.table === 'invoices') T.payments = T.payments.filter(p => !gone.has(p.invoice_id));
        if (this.table === 'customers') T.invoices.forEach(i => { if (gone.has(i.customer_id)) i.customer_id = null; });
      }
      if (this.op !== 'select') { save(); out = clone(out); }
      const rowsOut = this.op === 'select' || this.want ? out : null;
      if (this.one === 'single') {
        if (rowsOut?.length !== 1) throw fail('PGRST116', 'JSON object requested, multiple (or no) rows returned');
        return { data: rowsOut[0], error: null };
      }
      if (this.one === 'maybe') return { data: rowsOut?.[0] ?? null, error: null };
      return { data: rowsOut, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
}

export function demoClient() {
  return {
    from: table => new Query(table),
    async rpc(name, args = {}) {
      const b = biz();
      switch (name) {
        case 'claim_invites': return { data: 0, error: null };
        case 'billing_state': return { data: { enabled: false, active: true }, error: null };
        case 'is_admin': return { data: role() === 'admin', error: null };
        case 'next_invoice_number': { const n = b.next_number++; save(); return { data: n, error: null }; }
        case 'set_my_name': {
          const m = state.tables.members.find(x => x.user_id === user().id);
          m.name = String(args.new_name || '').trim(); save();
          return { data: null, error: null };
        }
        default: return { data: null, error: fail('', 'Not available in the demo') };
      }
    },
    auth: {
      async getSession() { return { data: { session: { user: clone(user()) } }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; },
      async updateUser() { return { data: { user: clone(user()) }, error: null }; }
    },
    functions: { async invoke() { return { data: null, error: new Error('Billing is not part of the demo') }; } }
  };
}
