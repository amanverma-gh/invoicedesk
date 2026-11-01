import { $, esc, num, fmt, fmtDate, today, isoDate, daysBetween, statusOf, statusChip,
  downloadCsv, round2 } from '../lib.js';
import { all, settings, paidByInvoice, memberName, loadMembers } from '../db.js';

const PERIODS = {
  this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', this_year: 'This year',
  last_year: 'Last year', last_12: 'Last 12 months', all: 'All time', custom: 'Custom dates'
};
const state = { period: 'this_year', from: '', to: '', currency: '' };

function periodRange(p) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const r = (a, b) => [isoDate(a), isoDate(b)];
  switch (p) {
    case 'this_month': return r(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'last_month': return r(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'this_quarter': { const q = m - (m % 3); return r(new Date(y, q, 1), new Date(y, q + 3, 0)); }
    case 'this_year': return r(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'last_year': return r(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case 'last_12': return r(new Date(y, m - 11, 1), new Date(y, m + 1, 0));
    case 'custom': return [state.from || '0000-01-01', state.to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

const monthKey = s => String(s).slice(0, 7);
const monthLabel = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);

function barChart(months, cur) {
  if (!months.length) return '<p class="empty">No data in this period.</p>';
  const max = Math.max(1, ...months.flatMap(m => [m.invoiced, m.received]));
  const W = 720, H = 220, padL = 8, padB = 28, gap = 6;
  const slot = (W - padL) / months.length, bw = Math.max(4, Math.min(22, (slot - gap * 2) / 2));
  const y = v => H - padB - (v / max) * (H - padB - 12);
  const step = Math.ceil(months.length / 12);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Invoiced and received per month">
    <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="axis"/>
    ${months.map((m, i) => {
      const cx = padL + slot * i + slot / 2;
      return `<g>
        <rect x="${cx - bw - 1}" y="${y(m.invoiced)}" width="${bw}" height="${H - padB - y(m.invoiced)}" rx="2" class="bar-inv"><title>${monthLabel(m.key)} invoiced: ${esc(fmt(m.invoiced, cur))}</title></rect>
        <rect x="${cx + 1}" y="${y(m.received)}" width="${bw}" height="${H - padB - y(m.received)}" rx="2" class="bar-rec"><title>${monthLabel(m.key)} received: ${esc(fmt(m.received, cur))}</title></rect>
        ${i % step === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(m.key)}</text>` : ''}
      </g>`;
    }).join('')}
  </svg>`;
}

export async function render(main) {
  main.innerHTML = '<div class="loading">Crunching numbers…</div>';
  const [invoices, payments, customers] = await Promise.all([
    all('invoices', { select: 'id,number,customer_id,bill_to,issue_date,due_date,currency,total,items,created_by', order: 'issue_date', asc: true }),
    all('payments', { select: 'invoice_id,amount,paid_on,method', order: 'paid_on', asc: true }),
    all('customers', { select: 'id,name' }),
    loadMembers()
  ]);
  const custName = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const paidAll = paidByInvoice(payments);
  const invById = Object.fromEntries(invoices.map(i => [i.id, i]));
  const currencies = [...new Set([settings().currency || 'INR', ...invoices.map(i => i.currency)])];
  if (!currencies.includes(state.currency)) state.currency = currencies[0];

  main.innerHTML = `
    <div class="page-head"><h1>Reports</h1>
      <div class="actions"><button class="btn" id="r-csv">Export CSV</button></div></div>
    <div class="toolbar">
      <select id="r-period" aria-label="Period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <span id="r-custom" class="custom-dates">
        <input type="date" id="r-from" aria-label="From date"> – <input type="date" id="r-to" aria-label="To date">
      </span>
      ${currencies.length > 1 ? `<select id="r-cur" aria-label="Currency">${currencies.map(c => `<option>${c}</option>`).join('')}</select>` : ''}
      <span class="sub" id="r-range"></span>
    </div>
    <div id="r-body"></div>`;

  $('#r-period', main).value = state.period;
  $('#r-from', main).value = state.from;
  $('#r-to', main).value = state.to;
  if ($('#r-cur', main)) $('#r-cur', main).value = state.currency;
  const body = $('#r-body', main);
  let csvRows = [];

  function draw() {
    $('#r-custom', main).hidden = state.period !== 'custom';
    const [from, to] = periodRange(state.period);
    const inRange = d => d && d >= from && d <= to;
    const cur = state.currency;
    const f = n => esc(fmt(n, cur));
    $('#r-range', main).textContent = state.period === 'all' ? '' : `${fmtDate(from)} – ${fmtDate(to)}`;

    const invs = invoices.filter(i => i.currency === cur && inRange(i.issue_date)).map(i => {
      const paid = round2(paidAll[i.id] || 0);
      return { ...i, total: Number(i.total), paid, balance: round2(Number(i.total) - paid), status: statusOf(i, paid),
        who: custName[i.customer_id] || (i.bill_to || '').split('\n')[0] || 'No customer' };
    });
    const pays = payments.filter(p => invById[p.invoice_id]?.currency === cur && inRange(p.paid_on));

    const invoiced = invs.reduce((s, i) => s + i.total, 0);
    const received = pays.reduce((s, p) => s + Number(p.amount), 0);
    const pending = invs.filter(i => i.balance > 0);
    const pendingAmt = pending.reduce((s, i) => s + i.balance, 0);
    const overdue = invs.filter(i => i.status === 'overdue');
    const overdueAmt = overdue.reduce((s, i) => s + i.balance, 0);
    const paidOnInvs = invs.reduce((s, i) => s + Math.min(i.paid, i.total), 0);
    const fullyPaid = invs.filter(i => i.status === 'paid');
    // days from invoice date to the payment that cleared it
    const lastPay = {};
    for (const p of payments) lastPay[p.invoice_id] = p.paid_on;
    const daysToPay = fullyPaid.map(i => daysBetween(i.issue_date, lastPay[i.id])).filter(d => d >= 0);
    const avgDays = daysToPay.length ? Math.round(daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) : null;

    // per month
    const monthMap = {};
    const mk = k => (monthMap[k] ??= { key: k, invoiced: 0, received: 0 });
    for (const i of invs) mk(monthKey(i.issue_date)).invoiced += i.total;
    for (const p of pays) mk(monthKey(p.paid_on)).received += Number(p.amount);
    let months = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));
    if (months.length) {  // fill empty months so the chart reads as a timeline
      const filled = [];
      const [y0, m0] = months[0].key.split('-').map(Number);
      const last = months.at(-1).key;
      for (let d = new Date(y0, m0 - 1, 1); isoDate(d).slice(0, 7) <= last; d.setMonth(d.getMonth() + 1)) filled.push(mk(isoDate(d).slice(0, 7)));
      months = filled.slice(-24);
    }

    // per customer
    const byCust = {};
    for (const i of invs) {
      const k = i.customer_id || 'name:' + i.who;
      const c = byCust[k] ??= { name: i.who, count: 0, invoiced: 0, received: 0, balance: 0, overdue: 0, last: '' };
      c.count++; c.invoiced += i.total; c.received += Math.min(i.paid, i.total); c.balance += Math.max(0, i.balance);
      if (i.status === 'overdue') c.overdue += i.balance;
      if (i.issue_date > c.last) c.last = i.issue_date;
    }
    const custRows = Object.values(byCust).sort((a, b) => b.invoiced - a.invoiced);

    // aging of unpaid balances
    const aging = [['Not due yet', 0, 0], ['1–30 days late', 0, 0], ['31–60 days late', 0, 0], ['61–90 days late', 0, 0], ['90+ days late', 0, 0]];
    for (const i of pending) {
      const late = i.due_date ? daysBetween(i.due_date, today()) : 0;
      const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      aging[b][1] += i.balance; aging[b][2]++;
    }

    // received by method
    const byMethod = {};
    for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount);
    const methodRows = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);

    // top items
    const byItem = {};
    for (const i of invs) for (const it of i.items || []) {
      const name = String(it.desc || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const r = byItem[k] ??= { name, qty: 0, amount: 0 };
      r.qty += num(it.qty); r.amount += num(it.qty) * num(it.rate);
    }
    const itemRows = Object.values(byItem).sort((a, b) => b.amount - a.amount).slice(0, 10);

    // per team member
    const byMember = {};
    for (const i of invs) {
      const r = byMember[i.created_by || '-'] ??= { name: memberName(i.created_by) || '—', count: 0, amount: 0 };
      r.count++; r.amount += i.total;
    }
    const memberRows = Object.values(byMember).sort((a, b) => b.amount - a.amount);

    csvRows = [['Customer', 'Invoices', `Invoiced (${cur})`, `Received (${cur})`, `Balance (${cur})`, `Overdue (${cur})`, 'Last invoice'],
      ...custRows.map(c => [c.name, c.count, c.invoiced.toFixed(2), c.received.toFixed(2), c.balance.toFixed(2), c.overdue.toFixed(2), c.last])];

    const maxMethod = Math.max(1, ...methodRows.map(r => r[1]));
    body.innerHTML = `
      <div class="kpis six">
        <div class="kpi"><span>Invoiced</span><strong>${f(invoiced)}</strong><em>${invs.length} invoice${invs.length === 1 ? '' : 's'}</em></div>
        <div class="kpi good"><span>Received</span><strong>${f(received)}</strong><em>${pays.length} payment${pays.length === 1 ? '' : 's'} in this period</em></div>
        <div class="kpi warn"><span>Pending</span><strong>${f(pendingAmt)}</strong><em>${pending.length} invoice${pending.length === 1 ? '' : 's'} not fully paid</em></div>
        <div class="kpi ${overdue.length ? 'bad' : ''}"><span>Overdue</span><strong>${f(overdueAmt)}</strong><em>${overdue.length} invoice${overdue.length === 1 ? '' : 's'} past due</em></div>
        <div class="kpi"><span>Collected</span><strong>${pct(paidOnInvs, invoiced)}%</strong><em>of the amount invoiced</em></div>
        <div class="kpi"><span>Avg. time to get paid</span><strong>${avgDays === null ? '—' : `${avgDays} day${avgDays === 1 ? '' : 's'}`}</strong><em>${fullyPaid.length} fully paid · avg. invoice ${f(invs.length ? invoiced / invs.length : 0)}</em></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Invoiced vs received</h2>
          <span class="legend"><i class="bar-inv"></i>Invoiced <i class="bar-rec"></i>Received</span></div>
        ${barChart(months, cur)}
      </div>

      <div class="card table-wrap">
        <div class="card-head"><h2>Earnings by customer</h2><button class="btn sm" id="r-cust-csv">CSV</button></div>
        <table class="tbl">
          <thead><tr><th>Customer</th><th class="r">Invoices</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Balance</th><th class="r">Overdue</th><th class="r">Share</th></tr></thead>
          <tbody>${custRows.length ? custRows.map(c => `<tr>
            <td><strong>${esc(c.name)}</strong><div class="sub">Last invoice ${fmtDate(c.last)}</div></td>
            <td class="r">${c.count}</td><td class="r">${f(c.invoiced)}</td><td class="r">${f(c.received)}</td>
            <td class="r ${c.balance > 0 ? 'due' : ''}">${f(c.balance)}</td><td class="r ${c.overdue > 0 ? 'bad-text' : ''}">${f(c.overdue)}</td>
            <td class="r"><span class="share"><i style="width:${pct(c.invoiced, invoiced)}%"></i></span> ${pct(c.invoiced, invoiced)}%</td>
          </tr>`).join('') : '<tr><td colspan="7" class="empty">No invoices in this period.</td></tr>'}</tbody>
          ${custRows.length > 1 ? `<tfoot><tr><td>Total</td><td class="r">${invs.length}</td><td class="r">${f(invoiced)}</td><td class="r">${f(paidOnInvs)}</td><td class="r">${f(pendingAmt)}</td><td class="r">${f(overdueAmt)}</td><td></td></tr></tfoot>` : ''}
        </table>
      </div>

      <div class="grid2">
        <div class="card">
          <h2>Pending by age</h2>
          <table class="tbl compact">${aging.map(([label, amt, n], i) => `<tr><td>${label}</td><td class="r sub">${n}</td>
            <td class="r ${i > 0 && amt > 0 ? 'bad-text' : ''}">${f(amt)}</td></tr>`).join('')}</table>
        </div>
        <div class="card">
          <h2>Received by payment method</h2>
          ${methodRows.length ? `<table class="tbl compact">${methodRows.map(([m, amt]) => `<tr><td>${esc(m)}</td>
            <td class="bar-cell"><span class="share"><i style="width:${pct(amt, maxMethod)}%"></i></span></td><td class="r">${f(amt)}</td></tr>`).join('')}</table>`
            : '<p class="empty">No payments in this period.</p>'}
        </div>
      </div>

      <div class="card table-wrap">
        <div class="card-head"><h2>Pending invoices</h2><span class="sub">${pending.length} not fully paid</span></div>
        <table class="tbl">
          <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th class="r">Total</th><th class="r">Balance</th><th>Status</th></tr></thead>
          <tbody>${pending.length ? pending.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map(i => `
            <tr class="click" data-id="${i.id}"><td><strong>${esc(i.number)}</strong></td><td>${esc(i.who)}</td>
            <td class="nowrap">${fmtDate(i.issue_date)}</td><td class="nowrap">${fmtDate(i.due_date)}</td>
            <td class="r">${f(i.total)}</td><td class="r due">${f(i.balance)}</td><td>${statusChip(i.status)}</td></tr>`).join('')
            : '<tr><td colspan="7" class="empty">Nothing pending. 🎉</td></tr>'}</tbody>
        </table>
      </div>

      <div class="grid2">
        <div class="card">
          <h2>Top items</h2>
          ${itemRows.length ? `<table class="tbl compact"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
            ${itemRows.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${round2(r.qty)}</td><td class="r">${f(r.amount)}</td></tr>`).join('')}</table>`
            : '<p class="empty">No items in this period.</p>'}
        </div>
        <div class="card">
          <h2>Invoices by team member</h2>
          ${memberRows.length ? `<table class="tbl compact"><thead><tr><th>Member</th><th class="r">Invoices</th><th class="r">Amount</th></tr></thead>
            ${memberRows.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${r.count}</td><td class="r">${f(r.amount)}</td></tr>`).join('')}</table>`
            : '<p class="empty">No invoices in this period.</p>'}
        </div>
      </div>`;

    $('#r-cust-csv', body).addEventListener('click', () => downloadCsv(`earnings-by-customer-${cur}.csv`, csvRows));
  }
  draw();

  body.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/invoice/${tr.dataset.id}`;
  });
  $('#r-period', main).addEventListener('change', e => { state.period = e.target.value; draw(); });
  $('#r-from', main).addEventListener('change', e => { state.from = e.target.value; draw(); });
  $('#r-to', main).addEventListener('change', e => { state.to = e.target.value; draw(); });
  $('#r-cur', main)?.addEventListener('change', e => { state.currency = e.target.value; draw(); });
  $('#r-csv', main).addEventListener('click', () => {
    const [from, to] = periodRange(state.period);
    downloadCsv(`invoices-${state.currency}.csv`, [
      ['Number', 'Customer', 'Date', 'Due date', 'Total', 'Paid', 'Balance', 'Status', 'Created by'],
      ...invoices.filter(i => i.currency === state.currency && i.issue_date >= from && i.issue_date <= to).map(i => {
        const paid = round2(paidAll[i.id] || 0);
        return [i.number, custName[i.customer_id] || (i.bill_to || '').split('\n')[0], i.issue_date, i.due_date || '',
          Number(i.total).toFixed(2), paid.toFixed(2), (Number(i.total) - paid).toFixed(2), statusOf(i, paid), memberName(i.created_by)];
      })
    ]);
  });
}
