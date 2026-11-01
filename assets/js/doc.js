// The printable invoice, its PDF export, and payment QR codes.
import { $, $$, esc, num, fmt, fmtDate, calc } from './lib.js';
import { S, payTypeName } from './db.js';

const loaded = {};
function loadScript(src) {
  loaded[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const PDF_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
export const preloadPdf = () => Promise.all(PDF_LIBS.map(loadScript)).catch(() => {});

function qrDataUrl(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(4, 2);
}

// upi://pay link; the amount is filled in when the invoice is in rupees
export function upiLink(m, inv, balance) {
  const p = new URLSearchParams({ pa: m.value.trim(), pn: S.biz?.name || '', cu: 'INR', tn: `Invoice ${inv.number}` });
  if (inv.currency === 'INR' && balance > 0) p.set('am', balance.toFixed(2));
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20').replace(/%40/g, '@');  // UPI apps expect a plain @
}

// Payment methods printed on the invoice. Hidden on fully paid invoices unless the admin chose to show them.
export function docMethods(inv, balance, methods) {
  if (balance <= 0 && !S.biz?.show_payment_when_paid) return [];
  const ids = inv.payment_method_ids || [];
  return methods.filter(m => ids.includes(m.id));
}

// call before docHtml when UPI QR codes may be drawn
export async function prepareDoc(inv, methods) {
  if (methods.some(m => m.type === 'upi' && (inv.payment_method_ids || []).includes(m.id))) await loadScript(QR_LIB);
}

export function docHtml(inv, { paid = 0, methods = [] } = {}) {
  const t = calc(inv, paid), f = n => esc(fmt(n, inv.currency));
  const st = S.biz?.settings || {};
  const items = (inv.items || []).filter(it => String(it.desc || '').trim() || num(it.rate));
  const pct = a => (a?.type === '%' && num(a.value) ? ` (${num(a.value)}%)` : '');
  const meta = [['Date', fmtDate(inv.issue_date)], ['Payment terms', inv.payment_terms],
    ['Due date', fmtDate(inv.due_date)], ['PO number', inv.po_number]].filter(([, v]) => String(v || '').trim());
  const shown = docMethods(inv, t.balance, methods);
  const isPaid = t.total > 0 && t.balance <= 0;

  const methodHtml = m => {
    let qr = m.qr_image;
    if (!qr && m.type === 'upi' && m.value.trim() && window.qrcode) qr = qrDataUrl(upiLink(m, inv, t.balance));
    return `<div class="d-pay">
      ${qr ? `<img class="d-qr" src="${qr}" alt="">` : ''}
      <div><div class="k">${esc(payTypeName(m))}</div><div class="v">${esc(m.value)}</div></div>
    </div>`;
  };

  return `<div class="doc">
    <div class="d-top">
      <div>
        ${st.logo ? `<img class="d-logo" src="${st.logo}" alt="">` : ''}
        <div class="d-from">${esc(inv.from_text)}</div>
      </div>
      <div class="d-title">
        <h1>${esc(inv.title || 'INVOICE')}</h1>
        <div class="num"># ${esc(inv.number || '—')}</div>
        ${isPaid ? '<div class="d-stamp">PAID</div>' : ''}
      </div>
    </div>
    <div class="d-mid">
      <div class="d-parties">
        ${inv.bill_to?.trim() ? `<div><div class="k">Bill to</div><div class="v">${esc(inv.bill_to)}</div></div>` : ''}
        ${inv.ship_to?.trim() ? `<div><div class="k">Ship to</div><div class="v">${esc(inv.ship_to)}</div></div>` : ''}
      </div>
      <table class="d-meta">
        ${meta.map(([k, v]) => `<tr><td>${k}:</td><td>${esc(v)}</td></tr>`).join('')}
        <tr class="bal"><td>Balance due:</td><td>${f(t.balance)}</td></tr>
      </table>
    </div>
    <table class="d-items">
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${items.map(it => `<tr><td>${esc(it.desc)}</td><td class="r">${esc(num(it.qty))}</td><td class="r">${f(num(it.rate))}</td><td class="r">${f(num(it.qty) * num(it.rate))}</td></tr>`).join('')}</tbody>
    </table>
    <table class="d-totals">
      <tr><td>Subtotal:</td><td>${f(t.subtotal)}</td></tr>
      ${inv.discount?.on ? `<tr><td>Discount${pct(inv.discount)}:</td><td>-${f(t.discount)}</td></tr>` : ''}
      ${inv.tax?.on ? `<tr><td>${esc(inv.tax.label || 'Tax')}${pct(inv.tax)}:</td><td>${f(t.tax)}</td></tr>` : ''}
      ${inv.shipping?.on ? `<tr><td>Shipping:</td><td>${f(t.shipping)}</td></tr>` : ''}
      <tr class="strong"><td>Total:</td><td>${f(t.total)}</td></tr>
      ${t.paid ? `<tr><td>Amount paid:</td><td>${f(t.paid)}</td></tr>` : ''}
      <tr class="strong bal"><td>Balance due:</td><td>${f(t.balance)}</td></tr>
    </table>
    ${shown.length ? `<div class="d-pays"><div class="d-h">Payment details</div><div class="d-pay-grid">${shown.map(methodHtml).join('')}</div></div>` : ''}
    ${inv.notes?.trim() || inv.terms?.trim() ? `<div class="d-notes">
      ${inv.notes?.trim() ? `<div class="k">Notes:</div><div class="v">${esc(inv.notes)}</div>` : ''}
      ${inv.terms?.trim() ? `<div class="k">Terms:</div><div class="v">${esc(inv.terms)}</div>` : ''}
    </div>` : ''}
  </div>`;
}

export const fileName = inv => `${`${inv.title || 'Invoice'} ${inv.number || ''}`.trim().replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;

export async function printDoc(inv, ctx) {
  await prepareDoc(inv, ctx.methods || []);
  const area = $('#print-area');
  area.innerHTML = docHtml(inv, ctx);
  let size = $('#page-size');
  if (!size) { size = document.createElement('style'); size.id = 'page-size'; document.head.appendChild(size); }
  size.textContent = `@page { size: ${inv.paper === 'Letter' ? 'letter' : 'A4'}; }`;
  await Promise.all($$('img', area).map(img => img.decode().catch(() => {})));
  window.print();
}

// Page sizes in mm. The invoice is laid out at a fixed pixel width that maps onto the printable width,
// and pages only break between item rows or before the totals / payment / notes blocks.
const PAPER = { Letter: [215.9, 279.4], A4: [210, 297] };
const MARGIN = 12.7;
const DOC_PX = 720;

export async function downloadPdf(inv, ctx) {
  await Promise.all([Promise.all(PDF_LIBS.map(loadScript)), prepareDoc(inv, ctx.methods || [])]);
  const [pw, ph] = PAPER[inv.paper] || PAPER.A4;
  const cw = pw - 2 * MARGIN, ch = ph - 2 * MARGIN;
  const mmPerPx = cw / DOC_PX;
  const pagePx = Math.floor(ch / mmPerPx);

  const host = document.createElement('div');
  host.className = 'pdf-host';
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${DOC_PX}px;background:#fff`;
  host.innerHTML = docHtml(inv, ctx);
  document.body.appendChild(host);
  try {
    await Promise.all($$('img', host).map(img => img.decode().catch(() => {})));
    if (document.fonts) await document.fonts.ready;
    const top = host.getBoundingClientRect().top;
    const rel = el => el.getBoundingClientRect().top - top;
    const breaks = $$('.d-items tbody tr, .d-totals, .d-pays, .d-notes', host).map(el => Math.floor(rel(el)));
    const height = Math.ceil(host.scrollHeight);
    const head = host.querySelector('.d-items thead').getBoundingClientRect();
    const rows = $$('.d-items tbody tr', host);
    const headTop = Math.floor(head.top - top), headH = Math.ceil(head.height);
    const tableEnd = rows.length ? Math.ceil(rows[rows.length - 1].getBoundingClientRect().bottom - top) : 0;

    const canvas = await window.html2canvas(host, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: 1280,
      onclone: doc => { doc.querySelector('.pdf-host').style.left = '0'; }
    });
    const s = canvas.width / DOC_PX;
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [pw, ph], orientation: 'portrait' });
    pdf.setProperties({ title: `${inv.title || 'Invoice'} ${inv.number || ''}`.trim() });
    for (let start = 0, page = 0; start < height - 1; page++) {
      const repeatHead = page > 0 && start > headTop && start < tableEnd ? headH : 0;
      let end = Math.min(start + pagePx - repeatHead, height);
      if (end < height) {
        const fits = breaks.filter(b => b > start + 40 && b <= end);
        if (fits.length) end = Math.max(...fits);
      }
      const bodyH = Math.round((end - start) * s), headPx = Math.round(repeatHead * s);
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = headPx + bodyH;
      const c = slice.getContext('2d');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, slice.width, slice.height);
      if (headPx) c.drawImage(canvas, 0, Math.round(headTop * s), canvas.width, headPx, 0, 0, slice.width, headPx);
      c.drawImage(canvas, 0, Math.round(start * s), canvas.width, bodyH, 0, headPx, slice.width, bodyH);
      if (page) pdf.addPage([pw, ph], 'portrait');
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, cw, slice.height / s * mmPerPx);
      start = end;
    }
    pdf.save(fileName(inv));
  } finally {
    host.remove();
  }
}
