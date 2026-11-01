import { $, esc, openDialog, confirmBox, toast, showError, readImage } from '../lib.js';
import { sb, S, q, all, isAdmin, PAY_TYPES, payTypeName } from '../db.js';

async function methodDialog(m = null) {
  let qr = m?.qr_image || null;
  const r = await openDialog({
    title: m ? 'Edit payment method' : 'Add payment method',
    danger: m ? 'Delete' : null,
    body: `
      <label class="fld"><span>Type</span><select name="type">
        ${Object.entries(PAY_TYPES).map(([k, t]) => `<option value="${k}" ${k === (m?.type || 'upi') ? 'selected' : ''}>${t.name}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Name shown on invoice</span><input name="label" value="${esc(m?.label)}" maxlength="80" placeholder=""></label>
      <label class="fld"><span id="pm-value-label"></span><textarea name="value" rows="3"></textarea></label>
      <div class="fld"><span>QR code image <em id="pm-qr-hint"></em></span>
        <div class="qr-pick">
          <img id="pm-qr-img" alt="" hidden>
          <input type="file" id="pm-qr-file" accept="image/*">
          <button type="button" class="btn sm ghost" id="pm-qr-clear" hidden>Remove</button>
        </div>
      </div>
      <label class="check"><input type="checkbox" name="is_default" ${m?.is_default ? 'checked' : ''}> Add to new invoices automatically</label>`,
    onOpen(dlg) {
      const type = $('[name=type]', dlg), value = $('[name=value]', dlg), label = $('[name=label]', dlg);
      value.value = m?.value || '';
      const img = $('#pm-qr-img', dlg), clear = $('#pm-qr-clear', dlg);
      const showQr = () => { img.hidden = !qr; clear.hidden = !qr; if (qr) img.src = qr; };
      const sync = () => {
        const t = PAY_TYPES[type.value];
        $('#pm-value-label', dlg).textContent = t.valueLabel;
        value.placeholder = t.placeholder;
        value.required = type.value !== 'qr';
        value.rows = type.value === 'bank' || type.value === 'custom' ? 4 : 1;
        label.placeholder = t.name;
        $('#pm-qr-hint', dlg).textContent = type.value === 'upi' ? '(optional: a QR with the exact amount is made automatically for UPI IDs)'
          : type.value === 'qr' ? '(required)' : '(optional)';
      };
      type.addEventListener('change', sync);
      $('#pm-qr-file', dlg).addEventListener('change', async e => {
        try { qr = await readImage(e.target.files[0], 400); showQr(); } catch (err) { showError(err); }
      });
      clear.addEventListener('click', () => { qr = null; $('#pm-qr-file', dlg).value = ''; showQr(); });
      sync(); showQr();
    }
  });
  if (!r) return null;
  try {
    if (r === 'danger') {
      if (!await confirmBox(`Delete ${payTypeName(m)}? It will no longer show on any invoice.`)) return null;
      await q(sb.from('payment_methods').delete().eq('id', m.id));
      toast('Payment method deleted');
      return 'deleted';
    }
    const row = { type: r.get('type'), label: r.get('label').trim(), value: r.get('value').trim(), qr_image: qr, is_default: r.get('is_default') === 'on' };
    if (row.type === 'qr' && !qr) { toast('Upload the QR code image', 'error'); return null; }
    const saved = m
      ? await q(sb.from('payment_methods').update(row).eq('id', m.id).select().single())
      : await q(sb.from('payment_methods').insert({ ...row, business_id: S.biz.id }).select().single());
    toast('Payment method saved');
    return saved;
  } catch (err) { showError(err); return null; }
}

export async function render(main) {
  main.innerHTML = '<div class="loading">Loading payment methods…</div>';
  const methods = await all('payment_methods', { order: 'created_at', asc: true });
  const admin = isAdmin();

  main.innerHTML = `
    <div class="page-head">
      <h1>Payment methods</h1>
      <div class="actions">${admin ? '<button class="btn primary" id="m-add">+ Add payment method</button>' : ''}</div>
    </div>
    <p class="lead">How customers can pay you: UPI, QR code, phone number, payment link, Zelle, bank transfer or anything else.
      Pick which ones to show on each invoice. ${S.biz.show_payment_when_paid ? 'They are also shown on fully paid invoices.' : 'They are hidden automatically once an invoice is fully paid.'}
      ${admin ? '' : '<br><strong>Only an admin can add or change payment methods.</strong>'}</p>
    <div class="pm-grid" id="m-list"></div>`;

  const list = main.querySelector('#m-list');
  function draw() {
    list.innerHTML = methods.length ? methods.map(m => `
      <div class="card pm ${admin ? 'click' : ''}" data-id="${m.id}">
        ${m.qr_image ? `<img src="${m.qr_image}" alt="QR code" class="pm-qr">` : `<div class="pm-icon">${esc(PAY_TYPES[m.type]?.name.slice(0, 1))}</div>`}
        <div class="pm-text">
          <div class="pm-name">${esc(payTypeName(m))} ${m.is_default ? '<span class="chip">Default</span>' : ''}</div>
          <div class="pm-type">${esc(PAY_TYPES[m.type]?.name)}</div>
          <div class="pm-value">${esc(m.value)}</div>
        </div>
      </div>`).join('')
      : `<div class="card empty">No payment methods yet.${admin ? ' Add your UPI ID, bank details or a payment link.' : ''}</div>`;
  }
  draw();

  if (!admin) return;
  main.querySelector('#m-add').addEventListener('click', async () => {
    const saved = await methodDialog();
    if (saved) { methods.push(saved); draw(); }
  });
  list.addEventListener('click', async e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const m = methods.find(x => x.id === card.dataset.id);
    const saved = await methodDialog(m);
    if (saved === 'deleted') methods.splice(methods.indexOf(m), 1);
    else if (saved) Object.assign(m, saved);
    draw();
  });
}
