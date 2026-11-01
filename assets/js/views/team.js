import { $, esc, fmtDate, toast, showError, confirmBox, initials } from '../lib.js';
import { sb, S, q, isAdmin, loadMembers } from '../db.js';

export async function render(main) {
  main.innerHTML = '<div class="loading">Loading team…</div>';
  const admin = isAdmin();
  const [members, invites] = await Promise.all([
    loadMembers(),
    admin ? q(sb.from('invites').select('*').eq('business_id', S.biz.id).order('created_at')) : []
  ]);
  const appUrl = location.origin + location.pathname;
  // re-render on a fresh element so event listeners are not added twice
  const rerender = () => { const fresh = main.cloneNode(false); main.replaceWith(fresh); render(fresh); };

  main.innerHTML = `
    <div class="page-head"><h1>Team <span class="count">${members.length}</span></h1></div>
    <div class="card perm-card">
      <div><strong>Admins</strong> can do everything: delete invoices and payments, manage payment methods, team and settings.</div>
      <div><strong>Members</strong> create invoices, customers and items and record payments. They can’t delete anything.
        Editing a saved invoice is <strong>${S.biz.member_can_edit ? 'allowed' : 'not allowed'}</strong> for members
        ${admin ? '(<a href="#/settings">change in Settings</a>)' : ''}.</div>
    </div>

    ${admin ? `
    <div class="card">
      <h2>Invite a team member</h2>
      <form id="t-invite" class="invite-form">
        <input type="email" name="email" required placeholder="name@example.com" aria-label="Email address">
        <select name="role" aria-label="Role"><option value="member">Member</option><option value="admin">Admin</option></select>
        <button class="btn primary">Send invite</button>
      </form>
      <p class="hint">Then ask them to open <a href="${esc(appUrl)}" target="_blank" rel="noopener">${esc(appUrl)}</a> and
        <strong>create an account with this same email</strong>. They join your team automatically after confirming their email.</p>
      ${invites.length ? `<h3>Waiting to join</h3><ul class="people">${invites.map(i => `
        <li><span class="avatar ghost">${esc(initials(i.email))}</span>
          <div class="grow"><strong>${esc(i.email)}</strong><div class="sub">Invited ${fmtDate(i.created_at)} as ${i.role}</div></div>
          <button class="btn sm ghost" data-cancel="${i.id}">Cancel invite</button></li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div class="card">
      <h2>Members</h2>
      <ul class="people">${members.map(m => {
        const self = m.user_id === S.user.id;
        return `<li>
          <span class="avatar">${esc(initials(m.name || m.email))}</span>
          <div class="grow"><strong>${esc(m.name || m.email)}</strong>${self ? ' <span class="chip">You</span>' : ''}
            <div class="sub">${esc(m.email)} · joined ${fmtDate(m.created_at)}</div></div>
          ${admin && !self ? `
            <select data-role="${m.user_id}" aria-label="Role of ${esc(m.email)}">
              <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
              <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="btn sm danger-ghost" data-remove="${m.user_id}">Remove</button>`
          : `<span class="chip ${m.role === 'admin' ? 'chip-admin' : ''}">${m.role === 'admin' ? 'Admin' : 'Member'}</span>`}
        </li>`;
      }).join('')}</ul>
    </div>`;

  if (!admin) return;
  $('#t-invite', main).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').trim().toLowerCase();
    if (members.some(m => m.email.toLowerCase() === email)) { toast('They are already in your team', 'error'); return; }
    try {
      await q(sb.from('invites').insert({ business_id: S.biz.id, email, role: fd.get('role') }));
      toast(`Invite saved for ${email}`);
      rerender();
    } catch (err) { showError(err); }
  });
  main.addEventListener('click', async e => {
    const cancel = e.target.closest('[data-cancel]')?.dataset.cancel;
    const remove = e.target.closest('[data-remove]')?.dataset.remove;
    try {
      if (cancel) {
        await q(sb.from('invites').delete().eq('id', cancel));
        toast('Invite cancelled'); rerender();
      } else if (remove) {
        const m = members.find(x => x.user_id === remove);
        if (!await confirmBox(`Remove ${m.name || m.email} from the team? Their invoices stay.`, 'Remove')) return;
        await q(sb.from('members').delete().eq('business_id', S.biz.id).eq('user_id', remove));
        toast('Removed from the team'); rerender();
      }
    } catch (err) { showError(err); }
  });
  main.addEventListener('change', async e => {
    const uid = e.target.dataset.role;
    if (!uid) return;
    try {
      await q(sb.from('members').update({ role: e.target.value }).eq('business_id', S.biz.id).eq('user_id', uid).select().single());
      toast('Role updated');
    } catch (err) { showError(err); rerender(); }
  });
}
