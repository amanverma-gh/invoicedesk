import { $, $$, esc, toast, showError, errorText, initials } from './lib.js';
import { sb, S, q, configured, isAdmin } from './db.js';
import * as invoices from './views/invoices.js';
import * as customers from './views/customers.js';
import * as items from './views/items.js';
import * as methods from './views/methods.js';
import * as reports from './views/reports.js';
import * as team from './views/team.js';
import * as settings from './views/settings.js';

const NAV = [
  ['invoices', 'Invoices', '🧾'], ['customers', 'Customers', '👥'], ['items', 'Items', '📦'],
  ['payment-methods', 'Payment methods', '💳'], ['reports', 'Reports', '📊'], ['team', 'Team', '🧑‍🤝‍🧑'], ['settings', 'Settings', '⚙️']
];
const VIEWS = {
  invoices: (m, p) => invoices.renderList(m, p),
  invoice: (m, p, id) => invoices.renderEditor(m, id || 'new', p),
  customers: m => customers.render(m),
  items: m => items.render(m),
  'payment-methods': m => methods.render(m),
  reports: m => reports.render(m),
  team: m => team.render(m),
  settings: (m, p) => settings.render(m, p, { onBusinessChange: drawShell })
};

const BIZ_KEY = 'invoicedesk.business';
const RESET_KEY = 'invoicedesk.reset';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

function show(id) {
  for (const s of ['setup', 'auth', 'onboard', 'shell']) $('#' + s).hidden = s !== id;
}

// ============================================================ auth screens

let authMode = 'signin';
function showAuth(mode = authMode, message = '') {
  authMode = mode;
  show('auth');
  const titles = { signin: 'Sign in', signup: 'Create your account', reset: 'Reset password', newpass: 'Choose a new password' };
  $('#auth-title').textContent = titles[mode];
  $('#auth-name').hidden = mode !== 'signup';
  $('#auth-name input').required = mode === 'signup';
  $('#auth-email').hidden = mode === 'newpass';
  $('#auth-email input').required = mode !== 'newpass';
  $('#auth-pass').hidden = mode === 'reset';
  $('#auth-pass input').required = mode !== 'reset';
  $('#auth-pass input').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  $('#auth-submit').textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', newpass: 'Save password' }[mode];
  $('#auth-links').innerHTML = {
    signin: '<a href="#" data-mode="signup">New here? Create an account</a><a href="#" data-mode="reset">Forgot password?</a>',
    signup: '<a href="#" data-mode="signin">Already have an account? Sign in</a>',
    reset: '<a href="#" data-mode="signin">Back to sign in</a>',
    newpass: ''
  }[mode];
  $('#auth-msg').innerHTML = message;
  $('#auth-msg').hidden = !message;
}

$('#auth-links').addEventListener('click', e => {
  const a = e.target.closest('[data-mode]');
  if (a) { e.preventDefault(); showAuth(a.dataset.mode); }
});

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = String(fd.get('email') || '').trim(), password = fd.get('password'), name = String(fd.get('name') || '').trim();
  const btn = $('#auth-submit');
  btn.disabled = true;
  const redirect = location.origin + location.pathname;
  try {
    if (authMode === 'signin') {
      const data = await q(sb.auth.signInWithPassword({ email, password }));
      await enter(data.user);
    } else if (authMode === 'signup') {
      const data = await q(sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirect } }));
      if (data.session) await enter(data.user);
      else showAuth('signin', `<strong>Check your email.</strong> We sent a confirmation link to ${esc(email)}. Click it, then sign in here.`);
    } else if (authMode === 'reset') {
      await q(sb.auth.resetPasswordForEmail(email, { redirectTo: redirect }));
      store.set(RESET_KEY, '1');
      showAuth('signin', `If ${esc(email)} has an account, a reset link is on its way.`);
    } else if (authMode === 'newpass') {
      const { user } = await q(sb.auth.updateUser({ password }));
      toast('Password updated');
      await enter(user);
    }
  } catch (err) {
    const m = errorText(err);
    $('#auth-msg').innerHTML = esc(/Invalid login/i.test(m) ? 'Wrong email or password.' : /not confirmed/i.test(m)
      ? 'Please confirm your email first: open the link we emailed you.' : m);
    $('#auth-msg').hidden = false;
  }
  btn.disabled = false;
});

// ============================================================ business onboarding

function showOnboarding() {
  show('onboard');
  $('#onboard-email').textContent = S.user.email;
}
$('#onboard-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = new FormData(e.target).get('name').trim();
  try {
    const id = await q(sb.rpc('create_business', { business_name: name }));
    store.set(BIZ_KEY, id);
    toast(`${name} created. You are its admin.`);
    await enter(S.user);
  } catch (err) { showError(err); }
});
$('#onboard-check').addEventListener('click', () => enter(S.user));
$$('[data-signout]').forEach(b => b.addEventListener('click', async () => {
  await sb.auth.signOut();
  Object.assign(S, { user: null, biz: null, me: null, memberships: [] });
  location.hash = '';
  showAuth('signin');
}));

// ============================================================ signed in

async function enter(user) {
  S.user = user;
  try {
    await sb.rpc('claim_invites');  // join any team that invited this email
    S.memberships = await q(sb.from('members').select('*, businesses(*)').eq('user_id', user.id).order('created_at'));
  } catch (err) { showError(err); return; }
  if (!S.memberships.length) return showOnboarding();
  const saved = store.get(BIZ_KEY);
  useBusiness(S.memberships.find(m => m.business_id === saved) || S.memberships[0]);
  show('shell');
  drawShell();
  route();
}

function useBusiness(m) {
  S.me = m;
  S.biz = m.businesses;
  store.set(BIZ_KEY, m.business_id);
}

function drawShell() {
  $('#nav').innerHTML = NAV.map(([k, label, icon]) => `<a href="#/${k}" data-nav="${k}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  $('#biz-name').innerHTML = S.memberships.length > 1
    ? `<select id="biz-switch" aria-label="Switch business">${S.memberships.map(m => `<option value="${m.business_id}" ${m.business_id === S.biz.id ? 'selected' : ''}>${esc(m.businesses.name)}</option>`).join('')}</select>`
    : esc(S.biz.name);
  $('#biz-switch')?.addEventListener('change', e => {
    useBusiness(S.memberships.find(m => m.business_id === e.target.value));
    drawShell();
    location.hash = '#/invoices';
    route();
  });
  $('#me').innerHTML = `<span class="avatar">${esc(initials(S.me.name || S.user.email))}</span>
    <span class="me-text"><strong>${esc(S.me.name || S.user.email)}</strong><em>${isAdmin() ? 'Admin' : 'Member'}</em></span>`;
  markNav();
}

function markNav() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'invoices';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name || (name === 'invoice' && a.dataset.nav === 'invoices')));
}

// ============================================================ routing  (#/view/id?query)

let leaveGuard = null, currentHash = '', skipNext = false;
async function route() {
  if (!S.biz) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name, id] = path.split('/');
  const view = VIEWS[name] ? name : 'invoices';
  currentHash = location.hash;
  leaveGuard = null;
  markNav();
  $('#shell').classList.remove('nav-open');
  // a fresh <main> each time, so listeners from the previous page never pile up
  const old = $('#main'), main = old.cloneNode(false);
  old.replaceWith(main);
  window.scrollTo(0, 0);
  try {
    // pick up permission changes the admin made since this page was opened
    const me = await q(sb.from('members').select('*, businesses(*)').eq('business_id', S.biz.id).eq('user_id', S.user.id).maybeSingle());
    if (!me) { toast('You are no longer a member of this business'); return enter(S.user); }
    const roleChanged = me.role !== S.me.role;
    Object.assign(S.me, me);
    S.biz = me.businesses;
    if (roleChanged) drawShell();
    const guard = await VIEWS[view](main, new URLSearchParams(query), id);
    if (typeof guard === 'function' && main.isConnected) leaveGuard = guard;
  } catch (err) {
    showError(err);
    main.innerHTML = `<div class="card empty">Something went wrong: ${esc(errorText(err))} <button class="btn sm" onclick="location.reload()">Reload</button></div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (skipNext) { skipNext = false; return; }
  if (leaveGuard && !leaveGuard()) { skipNext = true; location.hash = currentHash; return; }
  route();
});
$('#menu-btn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));

// ============================================================ start

async function boot() {
  if (!configured) return show('setup');
  // the reset email link lands here with ?code=; the library may announce it after getSession resolves
  const askNewPassword = () => showAuth('newpass', 'Enter a new password for your account.');
  let recovering = /[?&]code=/.test(location.search) && store.get(RESET_KEY) === '1';
  store.set(RESET_KEY, '');
  sb.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') { recovering = true; askNewPassword(); } });
  const { data: { session } } = await sb.auth.getSession();
  // tidy ?code= from email links out of the address bar
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  if (recovering) return askNewPassword();
  if (session) await enter(session.user);
  else showAuth('signin');
}
boot().catch(err => { showError(err); showAuth('signin'); });
