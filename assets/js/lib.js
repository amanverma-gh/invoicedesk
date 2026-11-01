// Small helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return y ? new Date(y, m - 1, d) : null;
}
export function addDays(s, days) {
  const d = parseDate(s) || new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export function fmtDate(s) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}
export function fmt(n, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n || 0); }
  catch { return `${currency} ${(n || 0).toFixed(2)}`; }
}

export const CURRENCIES = [
  ['INR', 'Indian Rupee'], ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'],
  ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'], ['NZD', 'New Zealand Dollar'],
  ['AED', 'UAE Dirham'], ['SAR', 'Saudi Riyal'], ['QAR', 'Qatari Riyal'], ['SGD', 'Singapore Dollar'],
  ['MYR', 'Malaysian Ringgit'], ['JPY', 'Japanese Yen'], ['CNY', 'Chinese Yuan'], ['HKD', 'Hong Kong Dollar'],
  ['CHF', 'Swiss Franc'], ['SEK', 'Swedish Krona'], ['NOK', 'Norwegian Krone'], ['DKK', 'Danish Krone'],
  ['PLN', 'Polish Złoty'], ['ZAR', 'South African Rand'], ['NGN', 'Nigerian Naira'], ['KES', 'Kenyan Shilling'],
  ['BRL', 'Brazilian Real'], ['MXN', 'Mexican Peso'], ['PKR', 'Pakistani Rupee'], ['BDT', 'Bangladeshi Taka'],
  ['LKR', 'Sri Lankan Rupee'], ['NPR', 'Nepalese Rupee'], ['PHP', 'Philippine Peso'], ['IDR', 'Indonesian Rupiah'],
  ['THB', 'Thai Baht'], ['VND', 'Vietnamese Dong'], ['KRW', 'South Korean Won'], ['TRY', 'Turkish Lira'], ['EGP', 'Egyptian Pound']
];
export const currencyOptions = selected =>
  CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c} – ${esc(n)}</option>`).join('');

// ---------- invoice math ----------

export function calc(inv, paid = 0) {
  const subtotal = (inv.items || []).reduce((s, it) => s + num(it.qty) * num(it.rate), 0);
  const adj = a => a || {};
  const d = adj(inv.discount), t = adj(inv.tax), sh = adj(inv.shipping);
  const discount = d.on ? (d.type === '%' ? subtotal * num(d.value) / 100 : num(d.value)) : 0;
  const taxable = subtotal - discount;
  const tax = t.on ? (t.type === '%' ? taxable * num(t.value) / 100 : num(t.value)) : 0;
  const shipping = sh.on ? num(sh.value) : 0;
  const total = round2(taxable + tax + shipping);
  return { subtotal: round2(subtotal), discount: round2(discount), tax: round2(tax), shipping: round2(shipping),
    total, paid: round2(paid), balance: round2(total - paid) };
}

// paid / partial / overdue / unpaid, from the stored total and the payments received
export function statusOf(inv, paid) {
  const total = num(inv.total), balance = round2(total - paid);
  if (total > 0 && balance <= 0) return 'paid';
  const due = parseDate(inv.due_date);
  if (due && due < parseDate(today())) return 'overdue';
  return paid > 0 ? 'partial' : 'unpaid';
}
export const STATUS_LABEL = { paid: 'Paid', partial: 'Partly paid', overdue: 'Overdue', unpaid: 'Unpaid' };
export const statusChip = s => `<span class="chip chip-${s}">${STATUS_LABEL[s]}</span>`;

// ---------- UI ----------

let toastTimer;
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg; el.className = `toast ${kind}`; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 5000 : 2800);
}

// Database errors in words a user understands
export function errorText(err) {
  const m = err?.message || String(err);
  // PGRST116: an update matched no row the user may change
  if (err?.code === '42501' || err?.code === 'PGRST116' || /row-level security|permission/i.test(m)) return 'You don’t have permission to do that. Ask your admin.';
  if (err?.code === '23505') return /number/.test(m) ? 'That invoice number is already used.' : 'That already exists.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Check your internet and try again.';
  return m;
}
export const showError = err => { console.error(err); toast(errorText(err), 'error'); };

// A dialog with a form. Resolves with the FormData on submit, or null on cancel.
export function openDialog({ title, body, submit = 'Save', danger = null, wide = false, onOpen }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg ${wide ? 'wide' : ''}`;
    dlg.innerHTML = `<form method="dialog">
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="dlg-body">${body}</div>
      <footer>
        ${danger ? `<button type="button" class="btn danger-ghost" data-danger>${esc(danger)}</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn" data-close>${submit ? 'Cancel' : 'Close'}</button>
        ${submit ? `<button type="submit" class="btn primary">${esc(submit)}</button>` : ''}
      </footer>
    </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let result = null;
    const finish = value => { result = value; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => finish(null)));
    dlg.querySelector('[data-danger]')?.addEventListener('click', () => finish('danger'));
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      finish(new FormData(form));
    });
    onOpen?.(dlg);
    dlg.showModal();
    dlg.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select')?.focus();
  });
}

export async function confirmBox(message, ok = 'Delete') {
  const r = await openDialog({ title: 'Are you sure?', body: `<p>${esc(message)}</p>`, submit: ok });
  return r instanceof FormData;
}

export function downloadCsv(name, rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Reads an image and shrinks it, so logos and QR codes stay small in the database
export function readImage(file, maxPx = 500) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export const initials = name => (name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
