import { $, esc, num, toast, showError, readImage, currencyOptions } from '../lib.js';
import { sb, S, q, isAdmin } from '../db.js';

export async function render(main, params, { onBusinessChange }) {
  const admin = isAdmin();
  const st = S.biz.settings || {};
  let logo = st.logo || null;

  main.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <form class="card" id="s-me">
      <h2>My account</h2>
      <div class="row2">
        <label class="fld"><span>Your name</span><input name="name" value="${esc(S.me.name)}" maxlength="80" required></label>
        <label class="fld"><span>Email</span><input value="${esc(S.user.email)}" disabled></label>
      </div>
      <div class="row2">
        <label class="fld"><span>New password</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave empty to keep"></label>
        <div class="fld end"><button class="btn primary">Save</button></div>
      </div>
    </form>

    ${admin ? `
    <form class="card" id="s-biz">
      <h2>Business</h2>
      <div class="row2">
        <label class="fld"><span>Business name *</span><input name="name" value="${esc(S.biz.name)}" required maxlength="120"></label>
        <div class="fld"><span>Logo</span>
          <div class="logo-pick"><img id="s-logo" alt="" hidden><input type="file" id="s-logo-file" accept="image/*">
          <button type="button" class="btn sm ghost" id="s-logo-clear" hidden>Remove</button></div></div>
      </div>
      <label class="fld"><span>“From” address on invoices</span><textarea name="from" rows="4" placeholder="Business name&#10;Address&#10;Phone · Email&#10;GSTIN / VAT number">${esc(st.from || '')}</textarea></label>

      <h3>Invoice defaults</h3>
      <div class="row3">
        <label class="fld"><span>Currency</span><select name="currency">${currencyOptions(st.currency || 'INR')}</select></label>
        <label class="fld"><span>Paper size</span><select name="paper"><option ${st.paper !== 'Letter' ? 'selected' : ''}>A4</option><option ${st.paper === 'Letter' ? 'selected' : ''}>Letter</option></select></label>
        <label class="fld"><span>Document title</span><input name="title" value="${esc(st.title || 'INVOICE')}"></label>
      </div>
      <div class="row3">
        <label class="fld"><span>Number prefix</span><input name="prefix" value="${esc(st.prefix || '')}" placeholder="e.g. INV-"></label>
        <label class="fld"><span>Next invoice number</span><input name="next_number" type="number" min="1" step="1" value="${S.biz.next_number}"></label>
        <label class="fld"><span>Due in (days)</span><input name="due_days" type="number" min="0" step="1" value="${esc(st.due_days ?? '')}" placeholder="e.g. 15"></label>
      </div>
      <div class="row3">
        <label class="fld"><span>Tax name</span><input name="tax_label" value="${esc(st.tax_label || '')}" placeholder="GST / VAT / Tax"></label>
        <label class="fld"><span>Default tax %</span><input name="tax_rate" type="number" min="0" step="0.01" value="${esc(st.tax_rate ?? '')}"></label>
        <span></span>
      </div>
      <div class="row2">
        <label class="fld"><span>Default notes</span><textarea name="notes" rows="3">${esc(st.notes || '')}</textarea></label>
        <label class="fld"><span>Default terms</span><textarea name="terms" rows="3">${esc(st.terms || '')}</textarea></label>
      </div>

      <h3>Permissions and privacy</h3>
      <label class="switch-row"><input type="checkbox" name="member_can_edit" ${S.biz.member_can_edit ? 'checked' : ''}>
        <span><strong>Members can edit saved invoices</strong><em>When off, members can only create new invoices; saved invoices are read-only for them. Members can never delete invoices.</em></span></label>
      <label class="switch-row"><input type="checkbox" name="show_payment_when_paid" ${S.biz.show_payment_when_paid ? 'checked' : ''}>
        <span><strong>Show payment details on fully paid invoices</strong><em>When off, UPI, QR, bank and other payment details are left off invoices with no balance due.</em></span></label>

      <div class="form-end"><button class="btn primary">Save business settings</button></div>
    </form>` : `
    <div class="card"><h2>${esc(S.biz.name)}</h2><p class="sub">Only an admin can change business settings.</p></div>`}`;

  $('#s-me', main).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const name = fd.get('name').trim();
      await q(sb.rpc('set_my_name', { b: S.biz.id, new_name: name }));
      await q(sb.auth.updateUser({ data: { name }, ...(fd.get('password') ? { password: fd.get('password') } : {}) }));
      S.me.name = name;
      e.target.password.value = '';
      toast('Account saved');
      onBusinessChange();
    } catch (err) { showError(err); }
  });

  if (!admin) return;
  const img = $('#s-logo', main), clear = $('#s-logo-clear', main);
  const showLogo = () => { img.hidden = !logo; clear.hidden = !logo; if (logo) img.src = logo; };
  showLogo();
  $('#s-logo-file', main).addEventListener('change', async e => {
    try { logo = await readImage(e.target.files[0], 500); showLogo(); } catch (err) { showError(err); }
  });
  clear.addEventListener('click', () => { logo = null; $('#s-logo-file', main).value = ''; showLogo(); });

  $('#s-biz', main).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const settings = {
      ...st, logo,
      from: fd.get('from').trim(), currency: fd.get('currency'), paper: fd.get('paper'), title: fd.get('title').trim() || 'INVOICE',
      prefix: fd.get('prefix').trim(), due_days: fd.get('due_days') === '' ? '' : Math.max(0, parseInt(fd.get('due_days'), 10)),
      tax_label: fd.get('tax_label').trim(), tax_rate: fd.get('tax_rate') === '' ? '' : num(fd.get('tax_rate')),
      notes: fd.get('notes'), terms: fd.get('terms')
    };
    const btn = e.target.querySelector('.form-end .btn');
    btn.disabled = true;
    try {
      const biz = await q(sb.from('businesses').update({
        name: fd.get('name').trim(), settings,
        next_number: Math.max(1, parseInt(fd.get('next_number'), 10) || 1),
        member_can_edit: fd.get('member_can_edit') === 'on',
        show_payment_when_paid: fd.get('show_payment_when_paid') === 'on'
      }).eq('id', S.biz.id).select().single());
      Object.assign(S.biz, biz);
      toast('Business settings saved');
      onBusinessChange();
    } catch (err) { showError(err); }
    btn.disabled = false;
  });
}
