import { $, esc, toast, showError } from '../lib.js';
import { sb, S, isAdmin, locked, PRICE, loadMembers } from '../db.js';

const fmtDay = d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const daysLeft = d => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));

// calls a billing function and sends the browser to the Polar page it returns
async function goTo(fn, returnHash, btn) {
  btn.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke(fn, {
      body: { business_id: S.biz.id, return_url: location.origin + location.pathname + returnHash }
    });
    if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error || error.message);
    location.href = data.url;
  } catch (err) { showError(err); btn.disabled = false; }
}

export async function render(main, id, { refresh }) {
  const b = S.billing || {};
  if (!b.enabled) { main.innerHTML = '<div class="card empty">Billing is turned off on this installation. Everything is free.</div>'; return; }

  // back from Polar checkout: the webhook usually lands within seconds
  if (id === 'success' && !b.subscribed) {
    main.innerHTML = '<div class="card empty">Payment received, activating your subscription…</div>';
    for (let i = 0; i < 15 && !S.billing.subscribed; i++) {
      await new Promise(r => setTimeout(r, 2000));
      await refresh();
    }
    if (S.billing.subscribed) toast('Subscription active. Thank you!');
    location.hash = '#/billing';
    return;
  }

  const admin = isAdmin();
  const admins = admin ? [] : (await loadMembers()).filter(m => m.role === 'admin');
  const isLocked = locked();
  const trial = !b.subscribed && b.trial_ends_at;

  let status;
  if (isLocked) status = `<div class="bill-status bad"><strong>${b.subscribed ? 'Your subscription has ended.' : 'Your free trial has ended.'}</strong>
    Subscribe to unlock your invoices, customers and reports. Nothing has been deleted.</div>`;
  else if (trial) status = `<div class="bill-status"><strong>Free trial</strong>: ${daysLeft(b.trial_ends_at)} days left (ends ${fmtDay(b.trial_ends_at)}).</div>`;
  else if (b.status === 'canceled') status = `<div class="bill-status warn"><strong>Cancelled.</strong> You have access until ${fmtDay(b.paid_until)}.</div>`;
  else status = `<div class="bill-status good"><strong>Active.</strong> Paid until ${fmtDay(b.paid_until)}${b.status === 'past_due' ? ' – the last renewal payment failed, please update your card' : ''}.</div>`;

  main.innerHTML = `
    <div class="page-head"><h1>Billing</h1></div>
    ${status}
    <div class="card plan">
      <div>
        <h2>InvoiceDesk Cloud</h2>
        <div class="plan-price">${PRICE}<span> per business</span></div>
        <ul class="ticks">
          <li>Unlimited team members, invoices and customers</li>
          <li>Reports, PDF invoices, UPI QR codes and payment tracking</li>
          <li>Hosted, secured and backed up for you</li>
          <li>Cancel any time</li>
        </ul>
      </div>
      <div class="plan-actions">
        ${admin ? `
          ${!b.subscribed || isLocked || b.status === 'canceled' ? `<button class="btn primary" id="b-subscribe">Subscribe – ${PRICE}</button>` : ''}
          ${b.subscribed ? '<button class="btn" id="b-portal">Manage billing &amp; invoices</button>' : ''}
          <p class="hint">Secure payment by Polar. Cards and international payments accepted.</p>`
        : `<p>Only an admin can manage billing. Ask ${admins.map(m => `<strong>${esc(m.name || m.email)}</strong>`).join(' or ') || 'your admin'}.</p>`}
      </div>
    </div>
    <p class="sub">Prefer to run it yourself? InvoiceDesk is open source: <a href="https://github.com/amanverma-gh/invoicedesk" target="_blank" rel="noopener">self-host it for free</a>.</p>`;

  $('#b-subscribe', main)?.addEventListener('click', e => goTo('billing-checkout', '#/billing/success', e.currentTarget));
  $('#b-portal', main)?.addEventListener('click', e => goTo('billing-portal', '#/billing', e.currentTarget));
}
