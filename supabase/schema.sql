-- InvoiceDesk database schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Every permission rule lives here (row level security), so it holds even if someone bypasses the UI.

-- ============================================================ tables

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  settings jsonb not null default '{}'::jsonb,          -- address, logo, currency, defaults…
  next_number integer not null default 1,                -- next invoice number
  member_can_edit boolean not null default false,        -- members may edit saved invoices
  show_payment_when_paid boolean not null default false, -- payment details on fully paid invoices
  created_at timestamptz not null default now()
);

create table public.members (
  business_id uuid not null references public.businesses on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  email text not null check (email = lower(trim(email)) and email like '%@%'),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);
create index invites_email_idx on public.invites (email);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  tax_id text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index customers_business_idx on public.customers (business_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  price numeric(14, 2) not null default 0,
  unit text not null default '',
  created_at timestamptz not null default now()
);
create index items_business_idx on public.items (business_id);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  type text not null check (type in ('upi', 'qr', 'phone', 'link', 'zelle', 'bank', 'custom')),
  label text not null default '',
  value text not null default '',   -- UPI ID, number, URL, Zelle email, bank details or free text
  qr_image text,                    -- data URL of an uploaded QR code
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index payment_methods_business_idx on public.payment_methods (business_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  number text not null check (length(trim(number)) > 0),
  title text not null default 'INVOICE',
  customer_id uuid references public.customers on delete set null,
  from_text text not null default '',
  bill_to text not null default '',
  ship_to text not null default '',
  issue_date date not null default current_date,
  due_date date,
  payment_terms text not null default '',
  po_number text not null default '',
  currency text not null default 'USD',
  paper text not null default 'A4',
  items jsonb not null default '[]'::jsonb,       -- [{item_id, desc, qty, rate}]
  discount jsonb not null default '{}'::jsonb,    -- {on, type, value}
  tax jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  notes text not null default '',
  terms text not null default '',
  payment_method_ids uuid[] not null default '{}',
  subtotal numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, number)
);
create index invoices_business_idx on public.invoices (business_id, issue_date desc);
create index invoices_customer_idx on public.invoices (customer_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  invoice_id uuid not null references public.invoices on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'Cash',
  reference text not null default '',
  note text not null default '',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_business_idx on public.payments (business_id, paid_on desc);

-- ============================================================ permission helpers

create function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where business_id = b and user_id = (select auth.uid()));
$$;

create function public.is_admin(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where business_id = b and user_id = (select auth.uid()) and role = 'admin');
$$;

-- admins always; members only when the admin turned on "members can edit saved invoices"
create function public.can_edit_invoices(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin(b) or (
    public.is_member(b) and exists (select 1 from public.businesses where id = b and member_can_edit)
  );
$$;

-- ============================================================ triggers

create function public.touch_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.created_by := old.created_by;  -- authorship can't be rewritten
  new.created_at := old.created_at;
  new.business_id := old.business_id;
  return new;
end $$;
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_invoice();

-- a payment always belongs to the same business as its invoice, and records who entered it
create function public.check_payment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.invoices where id = new.invoice_id and business_id = new.business_id) then
    raise exception 'Invoice not found';
  end if;
  new.created_by := auth.uid();
  return new;
end $$;
create trigger payments_check before insert on public.payments
  for each row execute function public.check_payment();

-- an invoice's customer must belong to the same business
create function public.check_invoice_customer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers where id = new.customer_id and business_id = new.business_id) then
    raise exception 'Customer not found';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger invoices_check_customer before insert or update on public.invoices
  for each row execute function public.check_invoice_customer();

-- a business always keeps at least one admin
create function public.keep_an_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
    and exists (select 1 from public.businesses where id = old.business_id)  -- not while deleting the business
    and not exists (
    select 1 from public.members where business_id = old.business_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'A business needs at least one admin';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger members_keep_admin before update or delete on public.members
  for each row execute function public.keep_an_admin();

-- ============================================================ functions the app calls

-- creates a business and makes the caller its admin
create function public.create_business(business_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  bid uuid;
  u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'Not signed in'; end if;
  insert into public.businesses (name) values (trim(business_name)) returning id into bid;
  insert into public.members (business_id, user_id, email, name, role)
    values (bid, u.id, u.email, coalesce(u.raw_user_meta_data ->> 'name', ''), 'admin');
  return bid;
end $$;

-- joins every business that invited the caller's (confirmed) email address
create function public.claim_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  u auth.users;
  n integer;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null or u.email_confirmed_at is null then return 0; end if;
  insert into public.members (business_id, user_id, email, name, role)
    select i.business_id, u.id, u.email, coalesce(u.raw_user_meta_data ->> 'name', ''), i.role
    from public.invites i where i.email = lower(u.email)
    on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.invites where email = lower(u.email);
  return n;
end $$;

-- hands out the next invoice number atomically, so two people never get the same one
create function public.next_invoice_number(b uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_member(b) then raise exception 'Not a member of this business'; end if;
  update public.businesses set next_number = next_number + 1 where id = b returning next_number - 1 into n;
  return n;
end $$;

-- lets a member change their own display name
create function public.set_my_name(b uuid, new_name text) returns void
language sql security definer set search_path = '' as $$
  update public.members set name = trim(new_name) where business_id = b and user_id = auth.uid();
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.can_edit_invoices(uuid),
  public.create_business(text), public.claim_invites(), public.next_invoice_number(uuid),
  public.set_my_name(uuid, text) to authenticated;

-- ============================================================ row level security

alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.payment_methods enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

-- businesses: members read, admins change settings (created through create_business)
create policy "members read" on public.businesses for select to authenticated using (public.is_member(id));
create policy "admins update" on public.businesses for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
create policy "admins delete" on public.businesses for delete to authenticated using (public.is_admin(id));

-- team: everyone sees the team, admins manage it (joining happens through claim_invites)
create policy "members read" on public.members for select to authenticated using (public.is_member(business_id));
create policy "admins update" on public.members for update to authenticated
  using (public.is_admin(business_id)) with check (public.is_admin(business_id));
create policy "admins remove" on public.members for delete to authenticated using (public.is_admin(business_id));

create policy "admins read" on public.invites for select to authenticated using (public.is_admin(business_id));
create policy "admins invite" on public.invites for insert to authenticated with check (public.is_admin(business_id));
create policy "admins cancel" on public.invites for delete to authenticated using (public.is_admin(business_id));

-- customers and items: the whole team adds and edits, only admins delete
create policy "members read" on public.customers for select to authenticated using (public.is_member(business_id));
create policy "members add" on public.customers for insert to authenticated with check (public.is_member(business_id));
create policy "members edit" on public.customers for update to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "admins delete" on public.customers for delete to authenticated using (public.is_admin(business_id));

create policy "members read" on public.items for select to authenticated using (public.is_member(business_id));
create policy "members add" on public.items for insert to authenticated with check (public.is_member(business_id));
create policy "members edit" on public.items for update to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "admins delete" on public.items for delete to authenticated using (public.is_admin(business_id));

-- payment methods hold bank details: the team uses them, only admins manage them
create policy "members read" on public.payment_methods for select to authenticated using (public.is_member(business_id));
create policy "admins add" on public.payment_methods for insert to authenticated with check (public.is_admin(business_id));
create policy "admins edit" on public.payment_methods for update to authenticated
  using (public.is_admin(business_id)) with check (public.is_admin(business_id));
create policy "admins delete" on public.payment_methods for delete to authenticated using (public.is_admin(business_id));

-- invoices: members create; editing a saved invoice needs admin or the "members can edit" switch;
-- only admins delete
create policy "members read" on public.invoices for select to authenticated using (public.is_member(business_id));
create policy "members create" on public.invoices for insert to authenticated with check (public.is_member(business_id));
create policy "editors edit" on public.invoices for update to authenticated
  using (public.can_edit_invoices(business_id)) with check (public.can_edit_invoices(business_id));
create policy "admins delete" on public.invoices for delete to authenticated using (public.is_admin(business_id));

-- payments: members record them, only admins delete
create policy "members read" on public.payments for select to authenticated using (public.is_member(business_id));
create policy "members record" on public.payments for insert to authenticated with check (public.is_member(business_id));
create policy "admins delete" on public.payments for delete to authenticated using (public.is_admin(business_id));

-- ============================================================ cloud billing

create table public.app_config (
  id boolean primary key default true check (id),
  billing_enabled boolean not null default false,
  trial_days integer not null default 14
);
insert into public.app_config default values;

create table public.subscriptions (
  business_id uuid primary key references public.businesses on delete cascade,
  status text not null default 'trialing',
  trial_ends_at timestamptz,
  paid_until timestamptz,
  polar_customer_id text,
  polar_subscription_id text,
  updated_at timestamptz not null default now()
);
-- only the Polar webhook (service role) writes here
alter table public.app_config enable row level security;
alter table public.subscriptions enable row level security;
create policy "members read" on public.subscriptions for select to authenticated using (public.is_member(business_id));

-- businesses that existed before billing get a fresh trial
insert into public.subscriptions (business_id, trial_ends_at)
  select id, now() + interval '14 days' from public.businesses on conflict do nothing;

-- trial still running, or paid up
create function public.is_paid_up(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select billing_enabled from public.app_config), false)
    or exists (select 1 from public.subscriptions s where s.business_id = b
      and greatest(coalesce(s.trial_ends_at, '-infinity'), coalesce(s.paid_until, '-infinity')) > now());
$$;
create function public.has_access(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member(b) and public.is_paid_up(b);
$$;
create function public.admin_access(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin(b) and public.is_paid_up(b);
$$;
create or replace function public.can_edit_invoices(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.admin_access(b) or (
    public.has_access(b) and exists (select 1 from public.businesses where id = b and member_can_edit)
  );
$$;

-- what the app shows on the Billing page
create function public.billing_state(b uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', c.billing_enabled,
    'active', public.is_paid_up(b),
    'status', coalesce(s.status, 'trialing'),
    'trial_ends_at', s.trial_ends_at,
    'paid_until', s.paid_until,
    'subscribed', s.polar_subscription_id is not null)
  from public.app_config c left join public.subscriptions s on s.business_id = b
  where public.is_member(b);
$$;

create or replace function public.create_business(business_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  bid uuid;
  u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'Not signed in'; end if;
  insert into public.businesses (name) values (trim(business_name)) returning id into bid;
  insert into public.members (business_id, user_id, email, name, role)
    values (bid, u.id, u.email, coalesce(u.raw_user_meta_data ->> 'name', ''), 'admin');
  insert into public.subscriptions (business_id, trial_ends_at)
    values (bid, now() + make_interval(days => (select trial_days from public.app_config)));
  return bid;
end $$;

create or replace function public.next_invoice_number(b uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.has_access(b) then raise exception 'Not allowed'; end if;
  update public.businesses set next_number = next_number + 1 where id = b returning next_number - 1 into n;
  return n;
end $$;

revoke execute on function public.is_paid_up(uuid), public.has_access(uuid), public.admin_access(uuid),
  public.billing_state(uuid) from anon, public;
grant execute on function public.is_paid_up(uuid), public.has_access(uuid), public.admin_access(uuid),
  public.billing_state(uuid) to authenticated;

-- when the trial or subscription ends, everything except the business name, team list and billing is locked
drop policy "admins update" on public.businesses;
create policy "admins update" on public.businesses for update to authenticated
  using (public.admin_access(id)) with check (public.admin_access(id));
drop policy "admins update" on public.members;
create policy "admins update" on public.members for update to authenticated
  using (public.admin_access(business_id)) with check (public.admin_access(business_id));
drop policy "admins remove" on public.members;
create policy "admins remove" on public.members for delete to authenticated using (public.admin_access(business_id));

drop policy "admins read" on public.invites;
drop policy "admins invite" on public.invites;
drop policy "admins cancel" on public.invites;
create policy "admins read" on public.invites for select to authenticated using (public.admin_access(business_id));
create policy "admins invite" on public.invites for insert to authenticated with check (public.admin_access(business_id));
create policy "admins cancel" on public.invites for delete to authenticated using (public.admin_access(business_id));

drop policy "members read" on public.customers;
drop policy "members add" on public.customers;
drop policy "members edit" on public.customers;
drop policy "admins delete" on public.customers;
create policy "members read" on public.customers for select to authenticated using (public.has_access(business_id));
create policy "members add" on public.customers for insert to authenticated with check (public.has_access(business_id));
create policy "members edit" on public.customers for update to authenticated
  using (public.has_access(business_id)) with check (public.has_access(business_id));
create policy "admins delete" on public.customers for delete to authenticated using (public.admin_access(business_id));

drop policy "members read" on public.items;
drop policy "members add" on public.items;
drop policy "members edit" on public.items;
drop policy "admins delete" on public.items;
create policy "members read" on public.items for select to authenticated using (public.has_access(business_id));
create policy "members add" on public.items for insert to authenticated with check (public.has_access(business_id));
create policy "members edit" on public.items for update to authenticated
  using (public.has_access(business_id)) with check (public.has_access(business_id));
create policy "admins delete" on public.items for delete to authenticated using (public.admin_access(business_id));

drop policy "members read" on public.payment_methods;
drop policy "admins add" on public.payment_methods;
drop policy "admins edit" on public.payment_methods;
drop policy "admins delete" on public.payment_methods;
create policy "members read" on public.payment_methods for select to authenticated using (public.has_access(business_id));
create policy "admins add" on public.payment_methods for insert to authenticated with check (public.admin_access(business_id));
create policy "admins edit" on public.payment_methods for update to authenticated
  using (public.admin_access(business_id)) with check (public.admin_access(business_id));
create policy "admins delete" on public.payment_methods for delete to authenticated using (public.admin_access(business_id));

drop policy "members read" on public.invoices;
drop policy "members create" on public.invoices;
drop policy "admins delete" on public.invoices;
create policy "members read" on public.invoices for select to authenticated using (public.has_access(business_id));
create policy "members create" on public.invoices for insert to authenticated with check (public.has_access(business_id));
create policy "admins delete" on public.invoices for delete to authenticated using (public.admin_access(business_id));

drop policy "members read" on public.payments;
drop policy "members record" on public.payments;
drop policy "admins delete" on public.payments;
create policy "members read" on public.payments for select to authenticated using (public.has_access(business_id));
create policy "members record" on public.payments for insert to authenticated with check (public.has_access(business_id));
create policy "admins delete" on public.payments for delete to authenticated using (public.admin_access(business_id));
