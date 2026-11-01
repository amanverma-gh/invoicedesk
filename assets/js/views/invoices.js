import { $, $$, esc, num, fmt, fmtDate, today, addDays, calc, statusOf, statusChip, STATUS_LABEL,
  openDialog, confirmBox, toast, showError, downloadCsv, currencyOptions, round2 } from '../lib.js';
import { sb, S, q, all, isAdmin, canEditInvoices, settings, paidByInvoice, memberName, loadMembers,
  payTypeName, RECEIVED_VIA } from '../db.js';
import { docHtml, prepareDoc, printDoc, downloadPdf, preloadPdf } from '../doc.js';
import { customerDialog, billToText } from './customers.js';

// ============================================================ list

const listState = { search: '', status: '', customer: '' };

export async function renderList(main, params) {
  if (params.get('customer') !== null) listState.customer = params.get('customer');
  main.innerHTML = '<div class="loading">Loading invoices…</div>';
  const [invoices, payments, customers] = await Promise.all([
    all('invoices', { select: 'id,number,title,customer_id,bill_to,issue_date,due_date,currency,total,created_by', order: 'issue_date' }),
    all('payments', { select: 'invoice_id,amount' }),
    all('customers', { select: 'id,name', order: 'name', asc: true }),
    loadMembers()
  ]);
  const paid = paidByInvoice(payments);
  const custName = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const rows = invoices.map(i => {
    const p = round2(paid[i.id] || 0);
    return { ...i, paid: p, balance: round2(Number(i.total) - p), status: statusOf(i, p),
      who: custName[i.customer_id] || (i.bill_to || '').split('\n')[0] || '—' };
  });

  // totals per currency, e.g. "₹12,000 · $300"
  const sumBy = (list, key) => {
    const by = {};
    for (const r of list) by[r.currency] = (by[r.currency] || 0) + r[key];
    const parts = Object.entries(by).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => fmt(v, c));
    return parts.length ? parts.join(' · ') : fmt(0, settings().currency || 'INR');
  };
  const open = rows.filter(r => r.status !== 'paid');
  const overdue = rows.filter(r => r.status === 'overdue');

  main.innerHTML = `
    <div class="page-head">
      <h1>Invoices <span class="count">${rows.length}</span></h1>
      <div class="actions">
        <button class="btn" id="l-csv">Export CSV</button>
        <a class="btn primary" href="#/invoice/new">+ New invoice</a>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span>Outstanding</span><strong>${esc(sumBy(open, 'balance'))}</strong><em>${open.length} pending invoice${open.length === 1 ? '' : 's'}</em></div>
      <div class="kpi ${overdue.length ? 'bad' : ''}"><span>Overdue</span><strong>${esc(sumBy(overdue, 'balance'))}</strong><em>${overdue.length} invoice${overdue.length === 1 ? '' : 's'}</em></div>
      <div class="kpi good"><span>Received (all time)</span><strong>${esc(sumBy(rows, 'paid'))}</strong><em>${rows.filter(r => r.status === 'paid').length} fully paid</em></div>
    </div>
    <div class="toolbar">
      <input type="search" id="l-search" placeholder="Search number or customer…" aria-label="Search invoices" value="${esc(listState.search)}">
      <select id="l-status" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="open">Pending (not fully paid)</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <select id="l-customer" aria-label="Filter by customer">
        <option value="">All customers</option>
        ${customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="card table-wrap"><table class="tbl">
      <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th class="r">Total</th><th class="r">Balance</th><th>Status</th><th>Created by</th></tr></thead>
      <tbody id="l-body"></tbody>
    </table></div>`;

  $('#l-status', main).value = listState.status;
  $('#l-customer', main).value = listState.customer;
  const body = $('#l-body', main);
  const visible = () => {
    const term = listState.search.toLowerCase();
    return rows.filter(r =>
      (!term || `${r.number} ${r.who} ${r.bill_to}`.toLowerCase().includes(term)) &&
      (!listState.status || (listState.status === 'open' ? r.status !== 'paid' : r.status === listState.status)) &&
      (!listState.customer || r.customer_id === listState.customer));
  };
  function draw() {
    const list = visible();
    body.innerHTML = list.length ? list.map(r => `<tr class="click" data-id="${r.id}">
        <td><strong>${esc(r.number)}</strong></td>
        <td>${esc(r.who)}</td>
        <td class="nowrap">${fmtDate(r.issue_date)}</td>
        <td class="nowrap">${fmtDate(r.due_date)}</td>
        <td class="r">${fmt(Number(r.total), r.currency)}</td>
        <td class="r ${r.balance > 0 ? 'due' : ''}">${fmt(r.balance, r.currency)}</td>
        <td>${statusChip(r.status)}</td>
        <td class="sub">${esc(memberName(r.created_by))}</td>
      </tr>`).join('')
      : `<tr><td colspan="8" class="empty">${rows.length ? 'No invoices match these filters.' : 'No invoices yet. Create your first invoice.'}</td></tr>`;
  }
  draw();

  $('#l-search', main).addEventListener('input', e => { listState.search = e.target.value; draw(); });
  $('#l-status', main).addEventListener('change', e => { listState.status = e.target.value; draw(); });
  $('#l-customer', main).addEventListener('change', e => { listState.customer = e.target.value; draw(); });
  body.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/invoice/${tr.dataset.id}`;
  });
  $('#l-csv', main).addEventListener('click', () => downloadCsv('invoices.csv', [
    ['Number', 'Customer', 'Date', 'Due date', 'Currency', 'Total', 'Paid', 'Balance', 'Status', 'Created by'],
    ...visible().map(r => [r.number, r.who, r.issue_date, r.due_date || '', r.currency, Number(r.total).toFixed(2),
      r.paid.toFixed(2), r.balance.toFixed(2), STATUS_LABEL[r.status], memberName(r.created_by)])
  ]));
}

// ============================================================ editor

const FIELDS = ['title', 'number', 'customer_id', 'from_text', 'bill_to', 'ship_to', 'issue_date', 'due_date',
  'payment_terms', 'po_number', 'currency', 'paper', 'items', 'discount', 'tax', 'shipping', 'notes', 'terms', 'payment_method_ids'];

function blankInvoice(methods) {
  const st = settings();
  const days = parseInt(st.due_days, 10);
  return {
    id: null, number: '', title: st.title || 'INVOICE', customer_id: null,
    from_text: st.from || S.biz.name, bill_to: '', ship_to: '',
    issue_date: today(), due_date: days >= 0 ? addDays(today(), days) : '',
    payment_terms: days > 0 ? `Net ${days}` : days === 0 ? 'Due on receipt' : '', po_number: '',
    currency: st.currency || 'INR', paper: st.paper || 'A4',
    items: [{ item_id: null, desc: '', qty: 1, rate: '' }],
    discount: { on: false, type: '%', value: '' },
    tax: { on: num(st.tax_rate) > 0, type: '%', value: st.tax_rate || '', label: st.tax_label || 'Tax' },
    shipping: { on: false, value: '' },
    notes: st.notes || '', terms: st.terms || '',
    payment_method_ids: methods.filter(m => m.is_default).map(m => m.id)
  };
}

// returns a guard: false while there are unsaved changes the user doesn't want to lose
export async function renderEditor(main, id, params) {
  main.innerHTML = '<div class="loading">Loading invoice…</div>';
  const isNew = id === 'new';
  const [customers, catalog, methods, row, payments] = await Promise.all([
    all('customers', { order: 'name', asc: true }),
    all('items', { order: 'name', asc: true }),
    all('payment_methods', { order: 'created_at', asc: true }),
    isNew ? null : q(sb.from('invoices').select('*').eq('id', id).maybeSingle()),
    isNew ? [] : q(sb.from('payments').select('*').eq('invoice_id', id).order('paid_on')),
    loadMembers()
  ]);
  if (!isNew && !row) { main.innerHTML = '<div class="card empty">Invoice not found. It may have been deleted.</div>'; return; }

  let inv;
  if (row) inv = row;
  else {
    inv = blankInvoice(methods);
    const from = params.get('from') && await q(sb.from('invoices').select('*').eq('id', params.get('from')).maybeSingle());
    if (from) {  // duplicate: same content, new number and dates
      for (const k of FIELDS) inv[k] = structuredClone(from[k]);
      inv.number = ''; inv.issue_date = today();
      const days = parseInt(settings().due_days, 10);
      inv.due_date = days >= 0 ? addDays(today(), days) : '';
    }
    const c = customers.find(x => x.id === params.get('customer'));
    if (c) { inv.customer_id = c.id; inv.bill_to = billToText(c); }
  }
  inv.items = Array.isArray(inv.items) && inv.items.length ? inv.items : [{ item_id: null, desc: '', qty: 1, rate: '' }];
  for (const k of ['discount', 'tax', 'shipping']) inv[k] = { on: false, type: '%', value: '', ...(inv[k] || {}) };

  const admin = isAdmin();
  const readOnly = !isNew && !canEditInvoices();
  let dirty = false;
  const paidSum = () => round2(payments.reduce((s, p) => s + Number(p.amount), 0));

  main.innerHTML = `
    <div class="page-head">
      <h1>${isNew ? 'New invoice' : `Invoice ${esc(inv.number)}`} <span id="e-status"></span></h1>
      <div class="actions"><a class="btn ghost" href="#/invoices">← All invoices</a></div>
    </div>
    ${readOnly ? `<div class="banner">🔒 This invoice is saved and read-only for you. Your admin can turn on
      <em>“Members can edit saved invoices”</em> in Settings. You can still download it and record payments.</div>` : ''}
    <div class="editor">
      <form class="card paper" id="e-form" autocomplete="off">
        <fieldset ${readOnly ? 'disabled' : ''}>
        <div class="p-top">
          <div class="p-from">
            <label class="fld"><span>From (your business)</span><textarea data-f="from_text" rows="4">${esc(inv.from_text)}</textarea></label>
          </div>
          <div class="p-title">
            <input class="title-in" data-f="title" value="${esc(inv.title)}" aria-label="Document title">
            <label class="fld inline"><span>#</span><input data-f="number" value="${esc(inv.number)}" placeholder="Auto on save" aria-label="Invoice number"></label>
          </div>
        </div>

        <div class="p-mid">
          <div class="p-bill">
            <label class="fld"><span>Customer</span>
              <div class="with-btn">
                <select data-f="customer_id" id="e-customer">
                  <option value="">— Choose a customer —</option>
                  ${customers.map(c => `<option value="${c.id}" ${c.id === inv.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select>
                <button type="button" class="btn sm" id="e-new-customer">+ New</button>
              </div>
            </label>
            <div class="row2">
              <label class="fld"><span>Bill to</span><textarea data-f="bill_to" rows="4" placeholder="Who is this invoice to?">${esc(inv.bill_to)}</textarea></label>
              <label class="fld"><span>Ship to (optional)</span><textarea data-f="ship_to" rows="4">${esc(inv.ship_to)}</textarea></label>
            </div>
          </div>
          <div class="p-meta">
            <label class="fld"><span>Date</span><input type="date" data-f="issue_date" value="${esc(inv.issue_date)}" required></label>
            <label class="fld"><span>Payment terms</span><input data-f="payment_terms" value="${esc(inv.payment_terms)}" placeholder="Net 15"></label>
            <label class="fld"><span>Due date</span><input type="date" data-f="due_date" value="${esc(inv.due_date || '')}"></label>
            <label class="fld"><span>PO number</span><input data-f="po_number" value="${esc(inv.po_number)}"></label>
          </div>
        </div>

        <datalist id="e-catalog">${catalog.map(it => `<option value="${esc(it.name)}">${esc(fmt(num(it.price), inv.currency))}</option>`).join('')}</datalist>
        <table class="lines">
          <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th><th></th></tr></thead>
          <tbody id="e-lines"></tbody>
        </table>
        <div class="line-actions">
          <button type="button" class="btn sm" id="e-add-line">+ Add line</button>
          ${catalog.length ? `<select id="e-add-catalog" class="sm" aria-label="Add a saved item"><option value="">+ Add saved item…</option>
            ${catalog.map(it => `<option value="${it.id}">${esc(it.name)} – ${esc(fmt(num(it.price), inv.currency))}</option>`).join('')}</select>`
            : '<a class="sub" href="#/items">Save items to pick them here</a>'}
        </div>

        <div class="p-bottom">
          <div class="p-notes">
            <label class="fld"><span>Notes</span><textarea data-f="notes" rows="3" placeholder="Thank you for your business!">${esc(inv.notes)}</textarea></label>
            <label class="fld"><span>Terms</span><textarea data-f="terms" rows="3">${esc(inv.terms)}</textarea></label>
          </div>
          <div class="p-totals">
            <div class="t-row"><span>Subtotal</span><strong id="t-sub"></strong></div>
            ${['discount', 'tax'].map(k => `
              <div class="t-row adj">
                <label class="check"><input type="checkbox" data-f="${k}.on" ${inv[k].on ? 'checked' : ''}>
                  ${k === 'tax' ? `<input class="tax-label" data-f="tax.label" value="${esc(inv.tax.label || 'Tax')}" aria-label="Tax name">` : 'Discount'}</label>
                <span class="adj-in">
                  <input type="number" step="0.01" min="0" data-f="${k}.value" value="${esc(inv[k].value)}" aria-label="${k} value">
                  <select data-f="${k}.type" aria-label="${k} type"><option value="%" ${inv[k].type === '%' ? 'selected' : ''}>%</option><option value="flat" ${inv[k].type !== '%' ? 'selected' : ''}>flat</option></select>
                </span>
              </div>`).join('')}
            <div class="t-row adj">
              <label class="check"><input type="checkbox" data-f="shipping.on" ${inv.shipping.on ? 'checked' : ''}> Shipping</label>
              <span class="adj-in"><input type="number" step="0.01" min="0" data-f="shipping.value" value="${esc(inv.shipping.value)}" aria-label="Shipping amount"></span>
            </div>
            <div class="t-row strong"><span>Total</span><strong id="t-total"></strong></div>
            <div class="t-row"><span>Amount paid</span><strong id="t-paid"></strong></div>
            <div class="t-row strong bal"><span>Balance due</span><strong id="t-bal"></strong></div>
          </div>
        </div>

        <div class="p-pay">
          <div class="p-pay-head"><strong>Payment details on this invoice</strong>
            ${admin ? '<a class="sub" href="#/payment-methods">Manage</a>' : ''}</div>
          ${methods.length ? `<div class="pay-picks">${methods.map(m => `
            <label class="pay-pick"><input type="checkbox" value="${m.id}" data-pay ${inv.payment_method_ids.includes(m.id) ? 'checked' : ''}>
              <span><strong>${esc(payTypeName(m))}</strong><em>${esc(m.value.split('\n')[0])}</em></span></label>`).join('')}</div>
            <p class="hint" id="e-pay-hint"></p>`
            : `<p class="hint">No payment methods yet. ${admin ? '<a href="#/payment-methods">Add UPI, bank, Zelle or a payment link</a>.' : 'Ask your admin to add them.'}</p>`}
        </div>
        </fieldset>
      </form>

      <aside class="side-panel">
        <div class="card stack">
          ${readOnly ? '' : `<button class="btn primary block" id="e-save">${isNew ? 'Save invoice' : 'Save changes'}</button>`}
          <button class="btn block" id="e-pdf">⬇ Download PDF</button>
          <div class="btn-row"><button class="btn" id="e-print">Print</button><button class="btn" id="e-preview">Preview</button></div>
          <label class="fld"><span>Currency</span><select data-f="currency" form="e-form" ${readOnly ? 'disabled' : ''}>${currencyOptions(inv.currency)}</select></label>
          <label class="fld"><span>Paper size</span><select data-f="paper" form="e-form" ${readOnly ? 'disabled' : ''}>
            <option ${inv.paper === 'A4' ? 'selected' : ''}>A4</option><option ${inv.paper === 'Letter' ? 'selected' : ''}>Letter</option></select></label>
        </div>
        ${isNew ? '' : `
        <div class="card stack">
          <div class="panel-head"><strong>Payments received</strong></div>
          <div id="e-payments"></div>
          <button class="btn block" id="e-record">+ Record payment</button>
        </div>
        <div class="card stack small">
          <div>Created by <strong>${esc(memberName(inv.created_by))}</strong><br><span class="sub">${new Date(inv.created_at).toLocaleString()}</span></div>
          ${inv.updated_by && inv.updated_at !== inv.created_at ? `<div>Last edited by <strong>${esc(memberName(inv.updated_by))}</strong><br><span class="sub">${new Date(inv.updated_at).toLocaleString()}</span></div>` : ''}
          <div class="btn-row"><a class="btn sm" href="#/invoice/new?from=${inv.id}">Duplicate</a>
            ${admin ? '<button class="btn sm danger-ghost" id="e-delete">Delete</button>' : ''}</div>
        </div>`}
      </aside>
    </div>`;

  const form = $('#e-form', main);
  const lines = $('#e-lines', main);

  // ---------- form ↔ invoice ----------
  function setField(path, value) {
    const keys = path.split('.');
    if (keys.length === 2) inv[keys[0]][keys[1]] = value; else inv[path] = value;
  }
  function drawLines() {
    lines.innerHTML = inv.items.map((it, i) => `<tr data-i="${i}">
      <td><input data-k="desc" list="e-catalog" value="${esc(it.desc)}" placeholder="Description of item or service" aria-label="Item"></td>
      <td class="r"><input data-k="qty" type="number" step="any" min="0" value="${esc(it.qty)}" aria-label="Quantity"></td>
      <td class="r"><input data-k="rate" type="number" step="any" min="0" value="${esc(it.rate)}" aria-label="Rate"></td>
      <td class="r amount">${esc(fmt(num(it.qty) * num(it.rate), inv.currency))}</td>
      <td>${readOnly ? '' : `<button type="button" class="icon-btn" data-remove aria-label="Remove line">✕</button>`}</td>
    </tr>`).join('');
  }
  function drawTotals() {
    const t = calc(inv, paidSum());
    const f = n => fmt(n, inv.currency);
    $('#t-sub', main).textContent = f(t.subtotal);
    $('#t-total', main).textContent = f(t.total);
    $('#t-paid', main).textContent = f(t.paid);
    $('#t-bal', main).textContent = f(t.balance);
    $$('tr[data-i]', lines).forEach(tr => {
      const it = inv.items[tr.dataset.i];
      tr.querySelector('.amount').textContent = f(num(it.qty) * num(it.rate));
    });
    const hint = $('#e-pay-hint', main);
    if (hint) hint.textContent = t.total > 0 && t.balance <= 0 && !S.biz.show_payment_when_paid
      ? 'This invoice is fully paid, so payment details are hidden on the PDF.' : '';
    $('#e-status', main).innerHTML = isNew ? '' : statusChip(statusOf({ ...inv, total: t.total }, t.paid));
  }
  drawLines();
  drawTotals();

  const touch = () => { dirty = true; drawTotals(); };
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.f) setField(el.dataset.f, el.type === 'checkbox' ? el.checked : el.value);
    else if (el.dataset.k) {
      const it = inv.items[el.closest('tr').dataset.i];
      it[el.dataset.k] = el.value;
      if (el.dataset.k === 'desc') {  // picked a saved item: fill its price (still editable)
        const match = catalog.find(c => c.name.toLowerCase() === el.value.trim().toLowerCase());
        if (match && match.id !== it.item_id) {
          it.item_id = match.id; it.rate = num(match.price);
          el.closest('tr').querySelector('[data-k=rate]').value = it.rate;
        }
      }
    } else if (el.dataset.pay !== undefined) {
      inv.payment_method_ids = $$('[data-pay]', form).filter(c => c.checked).map(c => c.value);
    }
    touch();
  });
  // side-panel selects belong to the form via form="e-form" but sit outside it in the DOM
  $$('.side-panel [data-f]', main).forEach(el => el.addEventListener('change', () => {
    setField(el.dataset.f, el.value);
    if (el.dataset.f === 'currency') drawLines();
    touch();
  }));

  lines.addEventListener('click', e => {
    if (!e.target.closest('[data-remove]')) return;
    inv.items.splice(e.target.closest('tr').dataset.i, 1);
    if (!inv.items.length) inv.items.push({ item_id: null, desc: '', qty: 1, rate: '' });
    drawLines(); touch();
  });
  $('#e-add-line', main)?.addEventListener('click', () => {
    inv.items.push({ item_id: null, desc: '', qty: 1, rate: '' });
    drawLines(); touch();
    $$('[data-k=desc]', lines).at(-1).focus();
  });
  $('#e-add-catalog', main)?.addEventListener('change', e => {
    const it = catalog.find(c => c.id === e.target.value);
    e.target.value = '';
    if (!it) return;
    const blank = inv.items.findIndex(x => !String(x.desc).trim() && !num(x.rate));
    const line = { item_id: it.id, desc: it.name, qty: 1, rate: num(it.price) };
    if (blank >= 0) inv.items[blank] = line; else inv.items.push(line);
    drawLines(); touch();
  });

  $('#e-customer', main).addEventListener('change', e => {
    const c = customers.find(x => x.id === e.target.value);
    inv.customer_id = c ? c.id : null;
    if (c) { inv.bill_to = billToText(c); $('[data-f=bill_to]', form).value = inv.bill_to; }
    touch();
  });
  $('#e-new-customer', main)?.addEventListener('click', async () => {
    const c = await customerDialog();
    if (!c || c === 'deleted') return;
    customers.push(c);
    const sel = $('#e-customer', main);
    sel.add(new Option(c.name, c.id, true, true));
    inv.customer_id = c.id; inv.bill_to = billToText(c);
    $('[data-f=bill_to]', form).value = inv.bill_to;
    touch();
  });
  $('[data-f=issue_date]', form).addEventListener('change', () => {
    const days = parseInt(settings().due_days, 10);
    if (isNew && days >= 0 && inv.issue_date) { inv.due_date = addDays(inv.issue_date, days); $('[data-f=due_date]', form).value = inv.due_date; }
  });

  // ---------- save ----------
  async function save() {
    const btn = $('#e-save', main);
    const filled = inv.items.filter(it => String(it.desc).trim() || num(it.rate));
    if (!inv.bill_to.trim() && !inv.customer_id) { toast('Choose a customer or fill in “Bill to”', 'error'); return; }
    if (!filled.length) { toast('Add at least one item', 'error'); return; }
    if (!inv.issue_date) { toast('Choose the invoice date', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (!String(inv.number).trim()) {
        const n = await q(sb.rpc('next_invoice_number', { b: S.biz.id }));
        inv.number = `${settings().prefix || ''}${n}`;
      }
      const t = calc({ ...inv, items: filled });
      const rowData = Object.fromEntries(FIELDS.map(k => [k, inv[k]]));
      Object.assign(rowData, {
        number: String(inv.number).trim(), items: filled.map(it => ({ item_id: it.item_id || null, desc: String(it.desc), qty: num(it.qty), rate: num(it.rate) })),
        due_date: inv.due_date || null, customer_id: inv.customer_id || null, subtotal: t.subtotal, total: t.total
      });
      const saved = isNew
        ? await q(sb.from('invoices').insert({ ...rowData, business_id: S.biz.id }).select('id').single())
        : await q(sb.from('invoices').update(rowData).eq('id', inv.id).select('id').single());
      dirty = false;
      toast(isNew ? `Invoice ${rowData.number} saved` : 'Changes saved');
      if (isNew) { location.hash = `#/invoice/${saved.id}`; return; }
      inv.number = rowData.number;
      $('[data-f=number]', form).value = inv.number;
      $('.page-head h1', main).firstChild.textContent = `Invoice ${inv.number} `;
    } catch (err) {
      showError(err);
    }
    btn.disabled = false; btn.textContent = isNew ? 'Save invoice' : 'Save changes';
  }
  $('#e-save', main)?.addEventListener('click', save);
  form.addEventListener('submit', e => { e.preventDefault(); if (!readOnly) save(); });

  // ---------- output ----------
  const docInv = () => ({ ...inv, total: calc(inv, 0).total, number: inv.number || '(on save)' });
  const ctx = () => ({ paid: paidSum(), methods });
  $('#e-pdf', main).addEventListener('pointerenter', preloadPdf, { once: true });
  $('#e-pdf', main).addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Preparing PDF…';
    try { await downloadPdf(docInv(), ctx()); }
    catch (err) { showError(err); toast('Could not create the PDF. Use Print → Save as PDF instead.', 'error'); }
    finally { btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
  });
  $('#e-print', main).addEventListener('click', () => printDoc(docInv(), ctx()).catch(showError));
  $('#e-preview', main).addEventListener('click', async () => {
    await prepareDoc(docInv(), methods).catch(() => {});
    openDialog({ title: 'Preview', wide: true, submit: null, body: `<div class="preview-paper">${docHtml(docInv(), ctx())}</div>` });
  });

  // ---------- payments ----------
  function drawPayments() {
    const box = $('#e-payments', main);
    if (!box) return;
    box.innerHTML = payments.length ? `<ul class="pay-list">${payments.map(p => `
      <li><div><strong>${esc(fmt(Number(p.amount), inv.currency))}</strong> · ${esc(p.method)}
        <div class="sub">${fmtDate(p.paid_on)}${p.reference ? ` · Ref ${esc(p.reference)}` : ''} · by ${esc(memberName(p.created_by))}</div>
        ${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}</div>
        ${admin ? `<button class="icon-btn" data-del-pay="${p.id}" aria-label="Delete payment">✕</button>` : ''}</li>`).join('')}</ul>`
      : '<p class="sub">No payments recorded yet.</p>';
  }
  drawPayments();

  $('#e-record', main)?.addEventListener('click', async () => {
    if (dirty && !readOnly) { toast('Save your changes first', 'error'); return; }
    const balance = calc(inv, paidSum()).balance;
    const r = await openDialog({
      title: 'Record payment',
      submit: 'Record payment',
      body: `
        <div class="row2">
          <label class="fld"><span>Amount (${esc(inv.currency)}) *</span><input name="amount" type="number" step="0.01" min="0.01" required value="${balance > 0 ? balance.toFixed(2) : ''}"></label>
          <label class="fld"><span>Date received *</span><input name="paid_on" type="date" required value="${today()}"></label>
        </div>
        <label class="fld"><span>Received by</span><select name="method">
          ${[...new Set([...RECEIVED_VIA.slice(0, -1), ...methods.map(payTypeName), 'Other'])].map(m => `<option>${esc(m)}</option>`).join('')}
        </select></label>
        <label class="fld"><span>Reference (UTR / cheque no. / transaction ID)</span><input name="reference" maxlength="120"></label>
        <label class="fld"><span>Note</span><input name="note" maxlength="300"></label>
        <p class="hint">Balance due now: <strong>${esc(fmt(balance, inv.currency))}</strong></p>`
    });
    if (!(r instanceof FormData)) return;
    try {
      const p = await q(sb.from('payments').insert({
        business_id: S.biz.id, invoice_id: inv.id, amount: round2(num(r.get('amount'))), paid_on: r.get('paid_on'),
        method: r.get('method'), reference: r.get('reference').trim(), note: r.get('note').trim()
      }).select().single());
      payments.push(p);
      payments.sort((a, b) => a.paid_on.localeCompare(b.paid_on));
      drawPayments(); drawTotals();
      toast(calc(inv, paidSum()).balance <= 0 ? 'Payment recorded – invoice fully paid' : 'Payment recorded');
    } catch (err) { showError(err); }
  });
  $('#e-payments', main)?.addEventListener('click', async e => {
    const id = e.target.closest('[data-del-pay]')?.dataset.delPay;
    if (!id || !await confirmBox('Delete this payment? The invoice balance goes back up.')) return;
    try {
      await q(sb.from('payments').delete().eq('id', id));
      payments.splice(payments.findIndex(p => p.id === id), 1);
      drawPayments(); drawTotals();
      toast('Payment deleted');
    } catch (err) { showError(err); }
  });

  $('#e-delete', main)?.addEventListener('click', async () => {
    if (!await confirmBox(`Delete invoice ${inv.number} and its payments? This cannot be undone.`)) return;
    try {
      await q(sb.from('invoices').delete().eq('id', inv.id));
      dirty = false;
      toast('Invoice deleted');
      location.hash = '#/invoices';
    } catch (err) { showError(err); }
  });

  return () => !dirty || confirm('You have unsaved changes on this invoice. Leave without saving?');
}
