import { esc, fmt, num, openDialog, confirmBox, toast, showError, downloadCsv } from '../lib.js';
import { sb, S, q, all, isAdmin, settings } from '../db.js';

// Add / edit a product or service. Resolves with the saved row, 'deleted', or null.
export async function itemDialog(it = null) {
  const r = await openDialog({
    title: it ? 'Edit item' : 'New item',
    danger: it && isAdmin() ? 'Delete item' : null,
    body: `
      <label class="fld"><span>Name *</span><input name="name" required maxlength="200" value="${esc(it?.name)}" placeholder="e.g. Website design, Consulting hour"></label>
      <label class="fld"><span>Description</span><textarea name="description" rows="2">${esc(it?.description)}</textarea></label>
      <div class="row2">
        <label class="fld"><span>Default price (${esc(settings().currency || 'INR')})</span><input name="price" type="number" step="0.01" min="0" value="${it ? num(it.price) : ''}" required></label>
        <label class="fld"><span>Unit</span><input name="unit" value="${esc(it?.unit)}" placeholder="hour, piece, month…"></label>
      </div>
      <p class="hint">The price is only a default: you can change it on every invoice.</p>`
  });
  if (!r) return null;
  try {
    if (r === 'danger') {
      if (!await confirmBox(`Delete ${it.name}? Existing invoices are not changed.`)) return null;
      await q(sb.from('items').delete().eq('id', it.id));
      toast('Item deleted');
      return 'deleted';
    }
    const row = { name: r.get('name').trim(), description: r.get('description').trim(), price: num(r.get('price')), unit: r.get('unit').trim() };
    const saved = it
      ? await q(sb.from('items').update(row).eq('id', it.id).select().single())
      : await q(sb.from('items').insert({ ...row, business_id: S.biz.id }).select().single());
    toast(it ? 'Item updated' : 'Item added');
    return saved;
  } catch (err) { showError(err); return null; }
}

export async function render(main) {
  main.innerHTML = '<div class="loading">Loading items…</div>';
  const items = await all('items', { order: 'name', asc: true });
  const cur = settings().currency || 'INR';
  let search = '';

  main.innerHTML = `
    <div class="page-head">
      <h1>Items <span class="count">${items.length}</span></h1>
      <div class="actions">
        <button class="btn" id="i-csv">Export CSV</button>
        <button class="btn primary" id="i-add">+ New item</button>
      </div>
    </div>
    <p class="lead">Save the products and services you sell. Pick them on an invoice and the price fills in. You can still change the price on each invoice.</p>
    <div class="toolbar"><input type="search" id="i-search" placeholder="Search items…" aria-label="Search items"></div>
    <div class="card table-wrap"><table class="tbl">
      <thead><tr><th>Item</th><th>Unit</th><th class="r">Default price</th></tr></thead>
      <tbody id="i-body"></tbody>
    </table></div>`;

  const body = main.querySelector('#i-body');
  function draw() {
    const term = search.toLowerCase();
    const list = items.filter(it => !term || (it.name + ' ' + it.description).toLowerCase().includes(term));
    body.innerHTML = list.length ? list.map(it => `<tr data-id="${it.id}" class="click">
        <td><strong>${esc(it.name)}</strong>${it.description ? `<div class="sub">${esc(it.description)}</div>` : ''}</td>
        <td>${esc(it.unit)}</td>
        <td class="r">${fmt(num(it.price), cur)}</td>
      </tr>`).join('')
      : `<tr><td colspan="3" class="empty">${items.length ? 'No items match your search.' : 'No items yet.'}</td></tr>`;
  }
  draw();

  main.querySelector('#i-search').addEventListener('input', e => { search = e.target.value; draw(); });
  main.querySelector('#i-add').addEventListener('click', async () => {
    const saved = await itemDialog();
    if (saved) { items.push(saved); items.sort((a, b) => a.name.localeCompare(b.name)); draw(); }
  });
  body.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const it = items.find(x => x.id === tr.dataset.id);
    const saved = await itemDialog(it);
    if (saved === 'deleted') items.splice(items.indexOf(it), 1);
    else if (saved) Object.assign(it, saved);
    draw();
  });
  main.querySelector('#i-csv').addEventListener('click', () => downloadCsv('items.csv', [
    ['Name', 'Description', 'Unit', 'Price'], ...items.map(it => [it.name, it.description, it.unit, num(it.price).toFixed(2)])
  ]));
}
