import { esc, fmt, openDialog, confirmBox, toast, showError, downloadCsv, statusOf } from '../lib.js';
import { sb, S, q, all, isAdmin, settings, paidByInvoice } from '../db.js';

const field = (name, label, value = '', attrs = '') =>
  `<label class="fld"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;

// Add / edit a customer. Resolves with the saved row, 'deleted', or null.
export async function customerDialog(c = null) {
  const r = await openDialog({
    title: c ? 'Edit customer' : 'New customer',
    danger: c && isAdmin() ? 'Delete customer' : null,
    body: `
      ${field('name', 'Name / company *', c?.name, 'required maxlength="200"')}
      <div class="row2">
        ${field('email', 'Email', c?.email, 'type="email"')}
        ${field('phone', 'Phone', c?.phone)}
      </div>
      <label class="fld"><span>Address</span><textarea name="address" rows="3">${esc(c?.address)}</textarea></label>
      ${field('tax_id', 'Tax ID (GSTIN / VAT / EIN)', c?.tax_id)}
      <label class="fld"><span>Private notes</span><textarea name="notes" rows="2" placeholder="Only your team sees this">${esc(c?.notes)}</textarea></label>`
  });
  if (!r) return null;
  try {
    if (r === 'danger') {
      if (!await confirmBox(`Delete ${c.name}? Their invoices stay, but are no longer linked to a customer.`)) return null;
      await q(sb.from('customers').delete().eq('id', c.id));
      toast('Customer deleted');
      return 'deleted';
    }
    const row = Object.fromEntries(['name', 'email', 'phone', 'address', 'tax_id', 'notes'].map(k => [k, String(r.get(k) || '').trim()]));
    const saved = c
      ? await q(sb.from('customers').update(row).eq('id', c.id).select().single())
      : await q(sb.from('customers').insert({ ...row, business_id: S.biz.id }).select().single());
    toast(c ? 'Customer updated' : 'Customer added');
    return saved;
  } catch (err) { showError(err); return null; }
}

// the "Bill to" block for a customer
export const billToText = c => [c.name, c.address, c.email, c.phone, c.tax_id && `Tax ID: ${c.tax_id}`].filter(Boolean).join('\n');

export async function render(main) {
  main.innerHTML = '<div class="loading">Loading customers…</div>';
  const [customers, invoices, payments] = await Promise.all([
    all('customers', { order: 'name', asc: true }),
    all('invoices', { select: 'id,customer_id,total,due_date,currency' }),
    all('payments', { select: 'invoice_id,amount' })
  ]);
  const paid = paidByInvoice(payments);
  const cur = settings().currency || 'INR';
  const stats = {};
  for (const i of invoices) {
    if (!i.customer_id) continue;
    const s = stats[i.customer_id] ??= { count: 0, invoiced: 0, balance: 0, overdue: 0 };
    const p = paid[i.id] || 0;
    s.count++;
    if (i.currency !== cur) continue;
    s.invoiced += Number(i.total); s.balance += Number(i.total) - p;
    if (statusOf(i, p) === 'overdue') s.overdue++;
  }
  let search = '';

  main.innerHTML = `
    <div class="page-head">
      <h1>Customers <span class="count">${customers.length}</span></h1>
      <div class="actions">
        <button class="btn" id="c-csv">Export CSV</button>
        <button class="btn primary" id="c-add">+ New customer</button>
      </div>
    </div>
    <div class="toolbar"><input type="search" id="c-search" placeholder="Search name, email, phone…" aria-label="Search customers"></div>
    <div class="card table-wrap"><table class="tbl">
      <thead><tr><th>Customer</th><th>Contact</th><th class="r">Invoices</th><th class="r">Invoiced (${cur})</th><th class="r">Balance due</th><th></th></tr></thead>
      <tbody id="c-body"></tbody>
    </table></div>`;

  const body = main.querySelector('#c-body');
  function draw() {
    const term = search.toLowerCase();
    const list = customers.filter(c => !term || [c.name, c.email, c.phone, c.tax_id].join(' ').toLowerCase().includes(term));
    body.innerHTML = list.length ? list.map(c => {
      const s = stats[c.id] || { count: 0, invoiced: 0, balance: 0, overdue: 0 };
      return `<tr data-id="${c.id}" class="click">
        <td><strong>${esc(c.name)}</strong>${c.tax_id ? `<div class="sub">Tax ID ${esc(c.tax_id)}</div>` : ''}</td>
        <td>${esc(c.email)}${c.phone ? `<div class="sub">${esc(c.phone)}</div>` : ''}</td>
        <td class="r">${s.count}${s.overdue ? ` <span class="chip chip-overdue">${s.overdue} overdue</span>` : ''}</td>
        <td class="r">${fmt(s.invoiced, cur)}</td>
        <td class="r ${s.balance > 0 ? 'due' : ''}">${fmt(s.balance, cur)}</td>
        <td class="r nowrap"><a class="btn sm" href="#/invoice/new?customer=${c.id}">+ Invoice</a> <a class="btn sm ghost" href="#/invoices?customer=${c.id}">Invoices</a></td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">${customers.length ? 'No customers match your search.' : 'No customers yet. Add your first customer to start invoicing.'}</td></tr>`;
  }
  draw();

  main.querySelector('#c-search').addEventListener('input', e => { search = e.target.value; draw(); });
  main.querySelector('#c-add').addEventListener('click', async () => {
    const saved = await customerDialog();
    if (saved) { customers.push(saved); customers.sort((a, b) => a.name.localeCompare(b.name)); draw(); }
  });
  body.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || e.target.closest('a')) return;
    const c = customers.find(x => x.id === tr.dataset.id);
    const saved = await customerDialog(c);
    if (saved === 'deleted') customers.splice(customers.indexOf(c), 1);
    else if (saved) Object.assign(c, saved);
    draw();
  });
  main.querySelector('#c-csv').addEventListener('click', () => downloadCsv('customers.csv', [
    ['Name', 'Email', 'Phone', 'Address', 'Tax ID', 'Invoices', `Invoiced (${cur})`, `Balance (${cur})`],
    ...customers.map(c => { const s = stats[c.id] || {}; return [c.name, c.email, c.phone, c.address, c.tax_id, s.count || 0, (s.invoiced || 0).toFixed(2), (s.balance || 0).toFixed(2)]; })
  ]));
}
