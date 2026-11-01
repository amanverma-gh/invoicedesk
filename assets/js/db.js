// Supabase client, the signed-in user's context, and data loading.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const cfg = window.INVOICEDESK || {};
export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseKey && !cfg.supabaseUrl.includes('YOUR-'));
// PKCE puts the email-link code in ?code= so it doesn't clash with the app's #/routes
export const sb = configured ? createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { flowType: 'pkce' } }) : null;

// S.biz is the current business, S.me the signed-in user's membership row in it
export const S = { user: null, biz: null, me: null, memberships: [] };

export const isAdmin = () => S.me?.role === 'admin';
export const canEditInvoices = () => isAdmin() || Boolean(S.biz?.member_can_edit);
export const settings = () => S.biz?.settings || {};

// throws Supabase errors so callers can show them
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// every row of a table for the current business (Supabase returns at most 1000 rows per request)
export async function all(table, { select = '*', order = 'created_at', asc = false, filter } = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = sb.from(table).select(select).eq('business_id', S.biz.id).order(order, { ascending: asc }).range(from, from + 999);
    if (filter) query = filter(query);
    const page = await q(query);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// display name of a team member (by user id)
let memberNames = {};
export async function loadMembers() {
  const members = await q(sb.from('members').select('*').eq('business_id', S.biz.id).order('created_at'));
  memberNames = Object.fromEntries(members.map(m => [m.user_id, m.name || m.email]));
  return members;
}
export const memberName = id => (id ? memberNames[id] || 'Former member' : '');

// sum of payments per invoice id
export function paidByInvoice(payments) {
  const map = {};
  for (const p of payments) map[p.invoice_id] = (map[p.invoice_id] || 0) + Number(p.amount);
  return map;
}

export const PAY_TYPES = {
  upi: { name: 'UPI ID', valueLabel: 'UPI ID', placeholder: 'yourname@okbank' },
  qr: { name: 'QR code', valueLabel: 'Note (optional)', placeholder: 'Scan to pay with any UPI / wallet app' },
  phone: { name: 'Phone number', valueLabel: 'Number', placeholder: '+91 98765 43210 (GPay / PhonePe / Paytm)' },
  link: { name: 'Payment link', valueLabel: 'Link', placeholder: 'https://paypal.me/yourname' },
  zelle: { name: 'Zelle', valueLabel: 'Zelle email or phone', placeholder: 'you@example.com' },
  bank: { name: 'Bank transfer', valueLabel: 'Bank details', placeholder: 'Account name\nAccount number\nIFSC / SWIFT / Routing\nBank name' },
  custom: { name: 'Custom', valueLabel: 'Details', placeholder: 'How to pay' }
};
export const payTypeName = m => m.label || PAY_TYPES[m.type]?.name || m.type;

// how a payment was received (Record payment)
export const RECEIVED_VIA = ['Cash', 'Bank transfer', 'UPI', 'Card', 'Cheque', 'Zelle', 'PayPal', 'Payment link', 'Other'];
