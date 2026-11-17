-- ระบบงานตัดหญ้า: ติดตั้งฐานข้อมูลใหม่ทั้งหมดในครั้งเดียว (รวม migrations 0001–0005)
-- ใช้กับโปรเจกต์ Supabase ที่ยังว่างเท่านั้น: SQL Editor > New query > วางทั้งไฟล์ > Run (รันครั้งเดียว)
-- ถ้าเคยรัน 0001–0004 ไปแล้ว ให้รันเฉพาะ migrations/0005_roles.sql แทน


-- =====================================================================
-- 0001_init.sql
-- =====================================================================
-- ระบบงานตัดหญ้า (ช่วงที่ 1): บริษัท สมาชิก คำเชิญ แขวง/หมวด และที่เก็บไฟล์
-- วิธีใช้: เปิด Supabase > SQL Editor > วางไฟล์นี้ทั้งไฟล์ > Run (รันครั้งเดียว)

create extension if not exists pgcrypto;

-- ---------- ตาราง ----------
create type public.member_role as enum ('owner', 'admin', 'staff');

-- ข้อมูลผู้ใช้ (อีเมล ชื่อ) ให้สมาชิกในบริษัทเดียวกันเห็นกันได้
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- บริษัท = หัวกระดาษและข้อมูลที่ใช้ออกเอกสาร
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  name_en text,
  tax_id text,
  branch text default 'สำนักงานใหญ่',
  address text,
  phone text,
  email text,
  signer_name text,
  signer_title text,
  bank_name text,
  bank_account_no text,
  bank_account_name text,
  logo_path text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

-- คำเชิญด้วยอีเมล: เมื่อคนนั้นสมัครหรือเข้าสู่ระบบด้วยอีเมลนี้ จะได้เป็นสมาชิกอัตโนมัติ
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  role public.member_role not null default 'staff' check (role <> 'owner'),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

-- แขวง (ผู้ว่าจ้าง) และหมวดในแขวง
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  short_name text,
  address text,
  phone text,
  tax_id text,
  director text,
  hmds text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agencies_company_idx on public.agencies (company_id);

-- ---------- ฟังก์ชันช่วยตรวจสิทธิ์ ----------
create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.user_id = auth.uid());
$$;

create or replace function public.has_role(cid uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.user_id = auth.uid() and m.role = any (roles));
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
create trigger agencies_touch before update on public.agencies for each row execute function public.touch_updated_at();

-- สร้างโปรไฟล์ให้ผู้ใช้ใหม่ทุกคน
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- สร้างบริษัทใหม่ ผู้สร้างเป็นเจ้าของ
create or replace function public.create_company(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  insert into public.companies (name, created_by) values (trim(p_name), auth.uid()) returning id into cid;
  insert into public.company_members (company_id, user_id, role) values (cid, auth.uid(), 'owner');
  return cid;
end $$;

-- รับคำเชิญทั้งหมดที่ตรงกับอีเมลของผู้ใช้ที่เข้าสู่ระบบ
create or replace function public.accept_invites()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  with inv as (
    delete from public.invites i where i.email = lower(auth.jwt() ->> 'email') returning i.company_id, i.role
  ), ins as (
    insert into public.company_members (company_id, user_id, role)
    select company_id, auth.uid(), role from inv
    on conflict (company_id, user_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- ห้ามทำให้บริษัทไม่เหลือเจ้าของ
create or replace function public.keep_one_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if exists (select 1 from public.companies c where c.id = old.company_id)
       and not exists (select 1 from public.company_members m
                       where m.company_id = old.company_id and m.role = 'owner' and m.user_id <> old.user_id) then
      raise exception 'บริษัทต้องมีเจ้าของอย่างน้อย 1 คน';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger members_keep_owner before update or delete on public.company_members
  for each row execute function public.keep_one_owner();

-- ---------- สิทธิ์ (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.invites enable row level security;
alter table public.agencies enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.company_members a join public.company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- บริษัท: สมาชิกเห็น, เจ้าของ/แอดมินแก้, เจ้าของลบ (สร้างผ่าน create_company เท่านั้น)
create policy companies_select on public.companies for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.has_role(id, '{owner,admin}')) with check (public.has_role(id, '{owner,admin}'));
create policy companies_delete on public.companies for delete to authenticated using (public.has_role(id, '{owner}'));

-- สมาชิก: สมาชิกเห็นรายชื่อ, เจ้าของจัดการได้ทุกคน, แอดมินจัดการได้เฉพาะคนที่ไม่ใช่เจ้าของ, ทุกคนออกจากบริษัทเองได้
create policy members_select on public.company_members for select to authenticated using (public.is_member(company_id));
create policy members_update on public.company_members for update to authenticated
  using (public.has_role(company_id, '{owner}') or (public.has_role(company_id, '{admin}') and role <> 'owner'))
  with check (public.has_role(company_id, '{owner}') or (public.has_role(company_id, '{admin}') and role <> 'owner'));
create policy members_delete on public.company_members for delete to authenticated
  using (user_id = auth.uid() or public.has_role(company_id, '{owner}') or (public.has_role(company_id, '{admin}') and role <> 'owner'));

create policy invites_all on public.invites for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));

create policy agencies_select on public.agencies for select to authenticated using (public.is_member(company_id));
create policy agencies_write on public.agencies for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));

grant execute on function public.create_company(text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
revoke execute on function public.create_company(text) from anon;
revoke execute on function public.accept_invites() from anon;

-- ---------- ที่เก็บไฟล์ (โลโก้ รูปงาน เอกสาร) ----------
-- ทุกไฟล์อยู่ใต้โฟลเดอร์ <company_id>/... สมาชิกบริษัทนั้นเท่านั้นที่อ่าน/เขียนได้
insert into storage.buckets (id, name, public) values ('company-files', 'company-files', false)
  on conflict (id) do nothing;

create policy files_select on storage.objects for select to authenticated using (
  bucket_id = 'company-files' and exists (
    select 1 from public.company_members m
    where m.company_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid()));
create policy files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'company-files' and exists (
    select 1 from public.company_members m
    where m.company_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid()));
create policy files_update on storage.objects for update to authenticated using (
  bucket_id = 'company-files' and exists (
    select 1 from public.company_members m
    where m.company_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid()));
create policy files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'company-files' and exists (
    select 1 from public.company_members m
    where m.company_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid() and m.role in ('owner', 'admin')));


-- =====================================================================
-- 0002_rounds.sql
-- =====================================================================
-- ระบบงานตัดหญ้า (ช่วงที่ 2): ใบสั่งจ้างของแต่ละหมวดในแต่ละงวด และสายทาง
-- วิธีใช้: Supabase > SQL Editor > New query > วางไฟล์นี้ทั้งไฟล์ > Run (รันครั้งเดียว หลังไฟล์ 0001)

-- ใบสั่งจ้าง 1 ใบ = 1 หมวด ในงวดหนึ่งของแขวงหนึ่ง
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete restrict,
  round_no int not null check (round_no > 0),
  hmd text not null default '',
  po_no text,
  po_date date,
  proj_no text,
  due_days int,
  due_date date,
  penalty text,
  vat_incl boolean not null default true,
  po_file_path text,
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, agency_id, round_no, hmd)
);
create index orders_company_idx on public.orders (company_id, agency_id, round_no);

-- สายทางในใบสั่งจ้าง
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  seq int not null default 0,
  code text not null default '',
  descr text not null default '',
  area numeric(14, 2) not null default 0 check (area >= 0),
  rate numeric(12, 4) not null default 0 check (rate >= 0),
  created_at timestamptz not null default now()
);
create index routes_order_idx on public.routes (order_id, seq);

create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

-- กันไม่ให้ผูกข้ามบริษัท (แขวงต้องเป็นของบริษัทเดียวกัน, สายทางต้องอยู่บริษัทเดียวกับใบสั่งจ้าง)
create or replace function public.check_same_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'orders' then
    if not exists (select 1 from public.agencies a where a.id = new.agency_id and a.company_id = new.company_id) then
      raise exception 'แขวงนี้ไม่ใช่ของบริษัทนี้';
    end if;
  elsif tg_table_name = 'routes' then
    if not exists (select 1 from public.orders o where o.id = new.order_id and o.company_id = new.company_id) then
      raise exception 'ใบสั่งจ้างนี้ไม่ใช่ของบริษัทนี้';
    end if;
  end if;
  return new;
end $$;
create trigger orders_same_company before insert or update on public.orders for each row execute function public.check_same_company();
create trigger routes_same_company before insert or update on public.routes for each row execute function public.check_same_company();

-- บันทึกใบสั่งจ้างพร้อมสายทางทั้งหมดในครั้งเดียว (สร้างใหม่เมื่อ p_id เป็น null)
create or replace function public.save_order(p_id uuid, p_company uuid, p_order jsonb, p_routes jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare oid uuid := p_id;
begin
  if oid is null then
    insert into public.orders (company_id, agency_id, round_no, hmd, po_no, po_date, proj_no, due_days, due_date, penalty, vat_incl, note, po_file_path)
    values (p_company, (p_order ->> 'agency_id')::uuid, (p_order ->> 'round_no')::int, coalesce(p_order ->> 'hmd', ''),
            nullif(p_order ->> 'po_no', ''), nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'proj_no', ''),
            nullif(p_order ->> 'due_days', '')::int, nullif(p_order ->> 'due_date', '')::date, nullif(p_order ->> 'penalty', ''),
            coalesce((p_order ->> 'vat_incl')::boolean, true), nullif(p_order ->> 'note', ''), nullif(p_order ->> 'po_file_path', ''))
    returning id into oid;
  else
    update public.orders set
      agency_id = (p_order ->> 'agency_id')::uuid, round_no = (p_order ->> 'round_no')::int, hmd = coalesce(p_order ->> 'hmd', ''),
      po_no = nullif(p_order ->> 'po_no', ''), po_date = nullif(p_order ->> 'po_date', '')::date, proj_no = nullif(p_order ->> 'proj_no', ''),
      due_days = nullif(p_order ->> 'due_days', '')::int, due_date = nullif(p_order ->> 'due_date', '')::date,
      penalty = nullif(p_order ->> 'penalty', ''), vat_incl = coalesce((p_order ->> 'vat_incl')::boolean, true),
      note = nullif(p_order ->> 'note', ''), po_file_path = coalesce(nullif(p_order ->> 'po_file_path', ''), po_file_path)
    where id = oid and company_id = p_company;
    if not found then raise exception 'ไม่พบใบสั่งจ้าง หรือไม่มีสิทธิ์แก้'; end if;
    delete from public.routes where order_id = oid;
  end if;
  insert into public.routes (order_id, company_id, seq, code, descr, area, rate)
  select oid, p_company, (r.ord - 1)::int, coalesce(r.v ->> 'code', ''), coalesce(r.v ->> 'descr', ''),
         coalesce(nullif(r.v ->> 'area', '')::numeric, 0), coalesce(nullif(r.v ->> 'rate', '')::numeric, 0)
  from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) with ordinality as r (v, ord);
  return oid;
end $$;
grant execute on function public.save_order(uuid, uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.save_order(uuid, uuid, jsonb, jsonb) from anon;

alter table public.orders enable row level security;
alter table public.routes enable row level security;

-- ทุกคนในบริษัทดูได้ เจ้าของ/แอดมินสร้าง แก้ ลบได้
create policy orders_select on public.orders for select to authenticated using (public.is_member(company_id));
create policy orders_write on public.orders for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));
create policy routes_select on public.routes for select to authenticated using (public.is_member(company_id));
create policy routes_write on public.routes for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));


-- =====================================================================
-- 0003_photos_docs_daily.sql
-- =====================================================================
-- ระบบงานตัดหญ้า (ช่วงที่ 3–5): รูปก่อน/หลังและสถานะสายทาง, เอกสาร, บันทึกรายวัน
-- วิธีใช้: Supabase > SQL Editor > New query > วางไฟล์นี้ทั้งไฟล์ > Run (รันครั้งเดียว หลังไฟล์ 0001 และ 0002)

-- =====================================================================
-- ช่วงที่ 3: สถานะสายทาง และรูปก่อน/หลัง
-- =====================================================================
-- done: ว่าง = ให้ระบบดูจากรูป (มีทั้งรูปก่อนและหลัง = เสร็จ), true = เสร็จ, false = ยังไม่เสร็จ
alter table public.routes add column if not exists done boolean;
alter table public.routes add column if not exists done_date date;

create table public.route_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  route_id uuid not null references public.routes (id) on delete cascade,
  kind text not null check (kind in ('b', 'a')), -- b = ก่อนตัด, a = หลังตัด
  path text not null,
  w int,
  h int,
  taken_date date,
  taken_time text,
  caption text not null default '',
  name text,
  sort int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index route_photos_route_idx on public.route_photos (route_id, kind, sort);
create index route_photos_order_idx on public.route_photos (order_id);

create or replace function public.check_photo_route()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.routes r
                 where r.id = new.route_id and r.order_id = new.order_id and r.company_id = new.company_id) then
    raise exception 'สายทางนี้ไม่ใช่ของใบสั่งจ้างหรือบริษัทนี้';
  end if;
  if split_part(new.path, '/', 1) <> new.company_id::text then
    raise exception 'ที่เก็บรูปไม่ตรงกับบริษัท';
  end if;
  return new;
end $$;
create trigger route_photos_check before insert or update on public.route_photos
  for each row execute function public.check_photo_route();

-- บันทึกใบสั่งจ้าง: สายทางเดิม (มี id) แก้ในที่เดิม รูปและสถานะไม่หาย, สายที่ไม่อยู่ในรายการแล้วถูกลบ, สายใหม่เพิ่ม
create or replace function public.save_order(p_id uuid, p_company uuid, p_order jsonb, p_routes jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  oid uuid := p_id;
  rs jsonb := coalesce(p_routes, '[]'::jsonb);
begin
  if oid is null then
    insert into public.orders (company_id, agency_id, round_no, hmd, po_no, po_date, proj_no, due_days, due_date, penalty, vat_incl, note, po_file_path)
    values (p_company, (p_order ->> 'agency_id')::uuid, (p_order ->> 'round_no')::int, coalesce(p_order ->> 'hmd', ''),
            nullif(p_order ->> 'po_no', ''), nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'proj_no', ''),
            nullif(p_order ->> 'due_days', '')::int, nullif(p_order ->> 'due_date', '')::date, nullif(p_order ->> 'penalty', ''),
            coalesce((p_order ->> 'vat_incl')::boolean, true), nullif(p_order ->> 'note', ''), nullif(p_order ->> 'po_file_path', ''))
    returning id into oid;
  else
    update public.orders set
      agency_id = (p_order ->> 'agency_id')::uuid, round_no = (p_order ->> 'round_no')::int, hmd = coalesce(p_order ->> 'hmd', ''),
      po_no = nullif(p_order ->> 'po_no', ''), po_date = nullif(p_order ->> 'po_date', '')::date, proj_no = nullif(p_order ->> 'proj_no', ''),
      due_days = nullif(p_order ->> 'due_days', '')::int, due_date = nullif(p_order ->> 'due_date', '')::date,
      penalty = nullif(p_order ->> 'penalty', ''), vat_incl = coalesce((p_order ->> 'vat_incl')::boolean, true),
      note = nullif(p_order ->> 'note', ''), po_file_path = coalesce(nullif(p_order ->> 'po_file_path', ''), po_file_path)
    where id = oid and company_id = p_company;
    if not found then raise exception 'ไม่พบใบสั่งจ้าง หรือไม่มีสิทธิ์แก้'; end if;

    delete from public.routes r
    where r.order_id = oid
      and r.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(rs) x where coalesce(x ->> 'id', '') <> '');

    update public.routes r set
      seq = (x.ord - 1)::int, code = coalesce(x.v ->> 'code', ''), descr = coalesce(x.v ->> 'descr', ''),
      area = coalesce(nullif(x.v ->> 'area', '')::numeric, 0), rate = coalesce(nullif(x.v ->> 'rate', '')::numeric, 0)
    from jsonb_array_elements(rs) with ordinality as x (v, ord)
    where coalesce(x.v ->> 'id', '') <> '' and r.id = (x.v ->> 'id')::uuid and r.order_id = oid;
  end if;

  insert into public.routes (order_id, company_id, seq, code, descr, area, rate)
  select oid, p_company, (x.ord - 1)::int, coalesce(x.v ->> 'code', ''), coalesce(x.v ->> 'descr', ''),
         coalesce(nullif(x.v ->> 'area', '')::numeric, 0), coalesce(nullif(x.v ->> 'rate', '')::numeric, 0)
  from jsonb_array_elements(rs) with ordinality as x (v, ord)
  where coalesce(x.v ->> 'id', '') = ''
     or not exists (select 1 from public.routes r where r.id = (x.v ->> 'id')::uuid and r.order_id = oid);
  return oid;
end $$;

-- พนักงานทุกคนในบริษัทตั้งสถานะ "เสร็จ" และวันที่เสร็จของสายทางได้ (แก้ข้อมูลอื่นของสายไม่ได้)
create or replace function public.set_route_status(p_route uuid, p_done boolean, p_done_date date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.routes r set done = p_done, done_date = p_done_date
  where r.id = p_route and public.is_member(r.company_id);
  if not found then raise exception 'ไม่พบสายทาง หรือไม่มีสิทธิ์'; end if;
end $$;
grant execute on function public.set_route_status(uuid, boolean, date) to authenticated;
revoke execute on function public.set_route_status(uuid, boolean, date) from anon;

alter table public.route_photos enable row level security;
create policy photos_select on public.route_photos for select to authenticated using (public.is_member(company_id));
create policy photos_insert on public.route_photos for insert to authenticated with check (public.is_member(company_id));
create policy photos_update on public.route_photos for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy photos_delete on public.route_photos for delete to authenticated using (public.is_member(company_id));

-- พนักงานลบไฟล์รูปงานในโฟลเดอร์ <company_id>/photos/ ได้ (ไฟล์อื่นยังลบได้เฉพาะเจ้าของ/แอดมิน)
create policy files_delete_photos on storage.objects for delete to authenticated using (
  bucket_id = 'company-files' and (storage.foldername(name))[2] = 'photos' and exists (
    select 1 from public.company_members m
    where m.company_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid()));

-- =====================================================================
-- ช่วงที่ 4: เอกสาร (ใบเสนอราคา หนังสือส่งมอบงาน ใบกำกับภาษี/ใบเสร็จรับเงิน)
-- =====================================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  kind text not null check (kind in ('qt', 'dl', 'rc')),
  no text not null check (length(trim(no)) > 0),
  doc_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  data jsonb not null default '{}'::jsonb,
  total numeric(14, 2) not null default 0,
  issued_at timestamptz,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, no)
);
create index documents_company_idx on public.documents (company_id, doc_date desc);
create index documents_order_idx on public.documents (order_id);
create trigger documents_touch before update on public.documents for each row execute function public.touch_updated_at();

-- กฎเอกสาร: ลบได้เฉพาะฉบับร่าง, ที่ยกเลิกแล้วแก้ไม่ได้, ใบกำกับภาษีที่ออกแล้วแก้ไม่ได้ (ยกเลิกได้อย่างเดียว)
create or replace function public.guard_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and exists (select 1 from public.companies c where c.id = old.company_id) then
      raise exception 'ลบได้เฉพาะฉบับร่าง เอกสารที่ออกแล้วให้กดยกเลิกแทน';
    end if;
    return old;
  end if;
  -- ใบสั่งจ้างถูกลบ: ปล่อยให้ตัดการเชื่อมโยงได้
  if new.order_id is null and old.order_id is not null
     and (new.kind, new.no, new.doc_date, new.status, new.data, new.total, new.void_reason)
         is not distinct from (old.kind, old.no, old.doc_date, old.status, old.data, old.total, old.void_reason) then
    return new;
  end if;
  if new.company_id <> old.company_id or new.kind <> old.kind then raise exception 'เปลี่ยนบริษัทหรือประเภทเอกสารไม่ได้'; end if;
  if old.status = 'void' then raise exception 'เอกสารที่ยกเลิกแล้วแก้ไขไม่ได้'; end if;
  if new.status = 'draft' and old.status <> 'draft' then raise exception 'เอกสารที่ออกแล้วกลับเป็นฉบับร่างไม่ได้'; end if;
  if old.kind = 'rc' and old.status = 'issued' then
    if new.status <> 'void'
       or (new.no, new.doc_date, new.data, new.total, new.order_id) is distinct from (old.no, old.doc_date, old.data, old.total, old.order_id) then
      raise exception 'ใบกำกับภาษีที่ออกแล้วแก้ไขไม่ได้ ต้องยกเลิกแล้วทำฉบับใหม่';
    end if;
  end if;
  if new.status = 'void' and coalesce(trim(new.void_reason), '') = '' then raise exception 'ใส่เหตุผลที่ยกเลิกเอกสาร'; end if;
  if new.status = 'issued' and old.status = 'draft' then new.issued_at = now(); end if;
  return new;
end $$;
create trigger documents_guard before update or delete on public.documents for each row execute function public.guard_document();

create or replace function public.check_doc_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_id is not null and not exists (select 1 from public.orders o where o.id = new.order_id and o.company_id = new.company_id) then
    raise exception 'ใบสั่งจ้างนี้ไม่ใช่ของบริษัทนี้';
  end if;
  return new;
end $$;
create trigger documents_same_company before insert or update on public.documents for each row execute function public.check_doc_company();

-- เลขที่ถัดไป เช่น GQT-69-001 (นับแยกตามประเภทและปี พ.ศ. ของวันที่เอกสาร)
create or replace function public.next_doc_no(p_company uuid, p_kind text, p_date date)
returns text language sql stable security invoker set search_path = '' as $$
  with p as (
    select (case p_kind when 'qt' then 'GQT' when 'dl' then 'GDL' else 'GRC' end) || '-' ||
           lpad(((extract(year from coalesce(p_date, current_date))::int + 543) % 100)::text, 2, '0') || '-' as pre
  )
  select p.pre || lpad((coalesce(max(substring(d.no from length(p.pre) + 1)::int), 0) + 1)::text, 3, '0')
  from p left join public.documents d on d.company_id = p_company and d.no ~ ('^' || p.pre || '[0-9]+$')
  group by p.pre;
$$;
grant execute on function public.next_doc_no(uuid, text, date) to authenticated;
revoke execute on function public.next_doc_no(uuid, text, date) from anon;

alter table public.documents enable row level security;
create policy documents_select on public.documents for select to authenticated using (public.is_member(company_id));
create policy documents_write on public.documents for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));

-- =====================================================================
-- ช่วงที่ 5: ลูกจ้างรายวัน และบันทึกประจำวัน
-- =====================================================================
create table public.crew (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  wage numeric(10, 2) not null default 0 check (wage >= 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index crew_company_idx on public.crew (company_id, sort);

-- บันทึก 1 วัน ต่อ 1 บริษัท: ทำงานงวด/ใบสั่งจ้างไหน สายไหน ใครมา ค่าแรง ค่าน้ำมัน
create table public.daily_logs (
  company_id uuid not null references public.companies (id) on delete cascade,
  log_date date not null,
  order_id uuid references public.orders (id) on delete set null,
  route_ids uuid[] not null default '{}',
  crew jsonb not null default '[]'::jsonb, -- [{id, name, wage, ot, on}]
  fuel numeric(12, 2) not null default 0,
  other numeric(12, 2) not null default 0,
  note text not null default '',
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, log_date)
);
create index daily_logs_order_idx on public.daily_logs (order_id);
create trigger daily_logs_touch before update on public.daily_logs for each row execute function public.touch_updated_at();
create trigger daily_logs_same_company before insert or update on public.daily_logs for each row execute function public.check_doc_company();

alter table public.crew enable row level security;
alter table public.daily_logs enable row level security;
create policy crew_select on public.crew for select to authenticated using (public.is_member(company_id));
create policy crew_write on public.crew for all to authenticated
  using (public.has_role(company_id, '{owner,admin}')) with check (public.has_role(company_id, '{owner,admin}'));
create policy daily_all on public.daily_logs for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));



-- =====================================================================
-- 0004_daily_km.sql
-- =====================================================================
-- ช่วงที่ 3–6 ส่วนเพิ่ม: บันทึกรายวันเลือกสายทางได้ทุกหมวด + ระยะที่ตัดได้ (กม.)
-- กม. ใช้ดูความคืบหน้าเท่านั้น ไม่เกี่ยวกับ ตร.ม. ที่ใช้คิดเงินและออกเอกสาร
-- รันหลัง 0003_photos_docs_daily.sql (รันซ้ำได้)

-- ความยาวสาย (กม.) กรอกครั้งเดียวที่หน้าสายทาง
alter table public.routes add column if not exists length_km numeric(10, 3) check (length_km is null or length_km >= 0);

-- งานของวัน: [{ "r": route_id, "km": ระยะที่ตัดได้ หรือ null }]
alter table public.daily_logs add column if not exists work jsonb not null default '[]'::jsonb;
create index if not exists daily_logs_routes_idx on public.daily_logs using gin (route_ids);

-- ข้อมูลเดิม: สายที่เลือกไว้ = งานที่ไม่ได้ใส่ กม.
update public.daily_logs d
set work = (select coalesce(jsonb_agg(jsonb_build_object('r', x, 'km', null)), '[]'::jsonb) from unnest(d.route_ids) x)
where d.work = '[]'::jsonb and cardinality(d.route_ids) > 0;

-- เก็บเฉพาะสายที่เป็นของบริษัทนี้ (สายที่ถูกลบจากใบสั่งจ้างไปแล้วจะหลุดออกเอง) และ route_ids ตรงกับ work เสมอ
create or replace function public.check_daily_routes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.work) <> 'array' then raise exception 'ข้อมูลงานไม่ถูกต้อง'; end if;
  if exists (select 1 from jsonb_array_elements(new.work) x where (x ->> 'km') is not null and (x ->> 'km')::numeric < 0) then
    raise exception 'ระยะ กม. ติดลบไม่ได้';
  end if;
  new.work := coalesce((
    select jsonb_agg(x order by o)
    from jsonb_array_elements(new.work) with ordinality as w (x, o)
    where exists (select 1 from public.routes r where r.id::text = x ->> 'r' and r.company_id = new.company_id)
  ), '[]'::jsonb);
  new.route_ids := coalesce((select array_agg((x ->> 'r')::uuid) from jsonb_array_elements(new.work) x), '{}');
  return new;
end $$;
drop trigger if exists daily_logs_routes on public.daily_logs;
create trigger daily_logs_routes before insert or update on public.daily_logs for each row execute function public.check_daily_routes();

-- พนักงานทุกคนกรอกความยาวสายได้ (แก้ข้อมูลอื่นของสายไม่ได้)
create or replace function public.set_route_length(p_route uuid, p_km numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_km is not null and p_km < 0 then raise exception 'ความยาวติดลบไม่ได้'; end if;
  update public.routes r set length_km = p_km
  where r.id = p_route and public.is_member(r.company_id);
  if not found then raise exception 'ไม่พบสายทาง หรือไม่มีสิทธิ์'; end if;
end $$;
grant execute on function public.set_route_length(uuid, numeric) to authenticated;
revoke execute on function public.set_route_length(uuid, numeric) from anon;


-- =====================================================================
-- 0005_roles.sql
-- =====================================================================
-- ระบบงานตัดหญ้า: แยกสิทธิ์ตามบทบาท (เจ้าของ / ธุรการ / บัญชี / หัวหน้าชุด / ดูอย่างเดียว)
-- วิธีใช้: Supabase > SQL Editor > New query > วางไฟล์นี้ทั้งไฟล์ > Run (รันครั้งเดียว หลังไฟล์ 0001–0004)
--
-- บทบาท (คนเดียวมีได้หลายบทบาท)
--   owner   เจ้าของ       ทำได้ทุกอย่าง จัดการสมาชิก ย้ายข้อมูล
--   office  ธุรการ        ใบสั่งจ้าง สายทาง แขวง ข้อมูลบริษัท ใบเสนอราคา หนังสือส่งมอบ ร่างใบกำกับภาษี/ใบเสร็จ
--   account บัญชี         ค่าแรง น้ำมัน รายชื่อลูกจ้าง ออก/ยกเลิกใบกำกับภาษี/ใบเสร็จ ดูเอกสารทั้งหมด
--   field   หัวหน้าชุด    บันทึกรายวัน (ไม่เห็นค่าแรง) รูปก่อน/หลัง น้ำมัน สถานะสาย ไม่เห็นราคาและเอกสาร
--   viewer  ดูอย่างเดียว   เห็นความคืบหน้า แก้ไม่ได้ ไม่เห็นเงิน
-- scope (เฉพาะคนที่มีแค่ field/viewer): จำกัดให้เห็นเฉพาะแขวง "<agency_id>" หรือหมวด "<agency_id>|<หมวด>" ว่าง = เห็นทั้งหมด
-- ข้อมูลเดิม: owner -> เจ้าของ, admin -> ธุรการ + บัญชี, staff -> หัวหน้าชุด

-- =====================================================================
-- บทบาทของสมาชิกและคำเชิญ
-- =====================================================================
alter table public.company_members add column if not exists roles text[];
alter table public.company_members add column if not exists scope text[] not null default '{}';
alter table public.invites add column if not exists roles text[];
alter table public.invites add column if not exists scope text[] not null default '{}';

update public.company_members set roles = case role when 'owner' then '{owner}'::text[] when 'admin' then '{office,account}'::text[] else '{field}'::text[] end
  where roles is null;
update public.invites set roles = case role when 'admin' then '{office,account}'::text[] else '{field}'::text[] end
  where roles is null;

alter table public.company_members alter column roles set default '{field}', alter column roles set not null;
alter table public.invites alter column roles set default '{field}', alter column roles set not null;
alter table public.company_members add constraint company_members_roles_ok
  check (cardinality(roles) > 0 and roles <@ '{owner,office,account,field,viewer}'::text[]);
alter table public.invites add constraint invites_roles_ok
  check (cardinality(roles) > 0 and roles <@ '{office,account,field,viewer}'::text[]);

-- คอลัมน์ role เดิมยังอยู่ (ให้โค้ดรุ่นก่อนใช้งานได้ระหว่างอัปโหลดโค้ดใหม่) ระบบตั้งให้ตรงกับ roles เอง
create or replace function public.sync_member_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- โค้ดรุ่นเก่าเปลี่ยน role อย่างเดียว: แปลงเป็น roles ให้
  if tg_op = 'UPDATE' and new.role is distinct from old.role and new.roles is not distinct from old.roles then
    new.roles := case new.role when 'owner' then '{owner}'::text[] when 'admin' then '{office,account}'::text[] else '{field}'::text[] end;
  elsif tg_op = 'INSERT' and new.roles = '{field}'::text[] and new.role is distinct from 'staff' then
    new.roles := case new.role when 'owner' then '{owner}'::text[] when 'admin' then '{office,account}'::text[] else '{field}'::text[] end;
  end if;
  new.roles := array(select distinct x from unnest(new.roles) x order by x);
  new.role := case when 'owner' = any (new.roles) then 'owner'::public.member_role
                   when new.roles && '{office,account}'::text[] then 'admin'::public.member_role
                   else 'staff'::public.member_role end;
  return new;
end $$;
drop trigger if exists members_sync_role on public.company_members;
create trigger members_sync_role before insert or update on public.company_members for each row execute function public.sync_member_role();
drop trigger if exists invites_sync_role on public.invites;
create trigger invites_sync_role before insert or update on public.invites for each row execute function public.sync_member_role();

-- รับคำเชิญ: ได้บทบาทและขอบเขตตามคำเชิญ
create or replace function public.accept_invites()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  with inv as (
    delete from public.invites i where i.email = lower(auth.jwt() ->> 'email') returning i.company_id, i.roles, i.scope
  ), ins as (
    insert into public.company_members (company_id, user_id, roles, scope)
    select company_id, auth.uid(), roles, scope from inv
    on conflict (company_id, user_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- ห้ามทำให้บริษัทไม่เหลือเจ้าของ
create or replace function public.keep_one_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if 'owner' = any (old.roles) and (tg_op = 'DELETE' or not ('owner' = any (new.roles))) then
    if exists (select 1 from public.companies c where c.id = old.company_id)
       and not exists (select 1 from public.company_members m
                       where m.company_id = old.company_id and 'owner' = any (m.roles) and m.user_id <> old.user_id) then
      raise exception 'บริษัทต้องมีเจ้าของอย่างน้อย 1 คน';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- =====================================================================
-- ฟังก์ชันตรวจสิทธิ์
-- =====================================================================
-- มีบทบาทใดบทบาทหนึ่งใน want (เจ้าของผ่านทุกข้อ)
create or replace function public.has_any(cid uuid, want text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m
                 where m.company_id = cid and m.user_id = auth.uid() and (m.roles && want or 'owner' = any (m.roles)));
$$;

-- แก้ข้อมูลหน้างานได้ (ทุกบทบาทยกเว้นดูอย่างเดียว)
create or replace function public.can_work(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_any(cid, '{office,account,field}');
$$;

-- อยู่ในขอบเขตแขวง/หมวดที่ได้รับมอบหมาย (p_hmd เป็น null = ดูระดับแขวง)
create or replace function public.in_scope(cid uuid, p_agency uuid, p_hmd text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.user_id = auth.uid() and (
      m.roles && '{owner,office,account}'::text[]
      or cardinality(m.scope) = 0
      or p_agency::text = any (m.scope)
      or (p_hmd is not null and (p_agency::text || '|' || p_hmd) = any (m.scope))
      or (p_hmd is null and exists (select 1 from unnest(m.scope) s where split_part(s, '|', 1) = p_agency::text))
    ));
$$;

create or replace function public.order_in_scope(p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.in_scope(o.company_id, o.agency_id, o.hmd) from public.orders o where o.id = p_order), false);
$$;

create or replace function public.route_in_scope(p_route uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.in_scope(o.company_id, o.agency_id, o.hmd)
                   from public.routes r join public.orders o on o.id = r.order_id where r.id = p_route), false);
$$;

do $$ declare f text; begin
  foreach f in array array['has_any(uuid, text[])', 'can_work(uuid)', 'in_scope(uuid, uuid, text)', 'order_in_scope(uuid)', 'route_in_scope(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon, public', f);
  end loop;
end $$;

-- =====================================================================
-- สิทธิ์รายตาราง
-- =====================================================================
-- บริษัท: ธุรการแก้หัวกระดาษได้ ลบได้เฉพาะเจ้าของ
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (public.has_any(id, '{office}')) with check (public.has_any(id, '{office}'));
drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated using (public.has_any(id, '{owner}'));

-- สมาชิกและคำเชิญ: เจ้าของจัดการ ทุกคนออกจากบริษัทเองได้
drop policy if exists members_update on public.company_members;
create policy members_update on public.company_members for update to authenticated
  using (public.has_any(company_id, '{owner}')) with check (public.has_any(company_id, '{owner}'));
drop policy if exists members_delete on public.company_members;
create policy members_delete on public.company_members for delete to authenticated
  using (user_id = auth.uid() or public.has_any(company_id, '{owner}'));
drop policy if exists invites_all on public.invites;
create policy invites_all on public.invites for all to authenticated
  using (public.has_any(company_id, '{owner}')) with check (public.has_any(company_id, '{owner}'));

-- แขวง: เห็นตามขอบเขต ธุรการแก้
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
  using (public.is_member(company_id) and public.in_scope(company_id, id, null));
drop policy if exists agencies_write on public.agencies;
create policy agencies_write on public.agencies for all to authenticated
  using (public.has_any(company_id, '{office}')) with check (public.has_any(company_id, '{office}'));

-- ใบสั่งจ้าง: เห็นตามขอบเขต ธุรการแก้
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (public.is_member(company_id) and public.in_scope(company_id, agency_id, hmd));
drop policy if exists orders_write on public.orders;
create policy orders_write on public.orders for all to authenticated
  using (public.has_any(company_id, '{office}')) with check (public.has_any(company_id, '{office}'));

-- สายทาง: ตารางจริงมีราคา เห็นได้เฉพาะธุรการ/บัญชี คนอื่นอ่านผ่าน routes_v (ราคาเป็นค่าว่าง)
drop policy if exists routes_select on public.routes;
create policy routes_select on public.routes for select to authenticated using (public.has_any(company_id, '{office,account}'));
drop policy if exists routes_write on public.routes;
create policy routes_write on public.routes for all to authenticated
  using (public.has_any(company_id, '{office}')) with check (public.has_any(company_id, '{office}'));

drop view if exists public.routes_v;
create view public.routes_v with (security_barrier) as
  select r.id, r.order_id, r.company_id, r.seq, r.code, r.descr, r.area,
         case when public.has_any(r.company_id, '{office,account}') then r.rate end as rate,
         r.done, r.done_date, r.length_km, r.created_at
  from public.routes r join public.orders o on o.id = r.order_id
  where public.is_member(r.company_id) and public.in_scope(o.company_id, o.agency_id, o.hmd);
revoke all on public.routes_v from anon, public;
grant select on public.routes_v to authenticated;

-- สถานะและความยาวสาย: ทุกบทบาทที่ทำงานหน้างาน ภายในขอบเขต
create or replace function public.set_route_status(p_route uuid, p_done boolean, p_done_date date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.routes r set done = p_done, done_date = p_done_date
  where r.id = p_route and public.can_work(r.company_id) and public.route_in_scope(r.id);
  if not found then raise exception 'ไม่พบสายทาง หรือไม่มีสิทธิ์'; end if;
end $$;
create or replace function public.set_route_length(p_route uuid, p_km numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_km is not null and p_km < 0 then raise exception 'ความยาวติดลบไม่ได้'; end if;
  update public.routes r set length_km = p_km
  where r.id = p_route and public.can_work(r.company_id) and public.route_in_scope(r.id);
  if not found then raise exception 'ไม่พบสายทาง หรือไม่มีสิทธิ์'; end if;
end $$;

-- รูปก่อน/หลัง: เห็นตามขอบเขต ทุกบทบาทยกเว้นดูอย่างเดียวเพิ่ม/แก้/ลบได้
drop policy if exists photos_select on public.route_photos;
drop policy if exists photos_insert on public.route_photos;
drop policy if exists photos_update on public.route_photos;
drop policy if exists photos_delete on public.route_photos;
create policy photos_select on public.route_photos for select to authenticated
  using (public.is_member(company_id) and public.order_in_scope(order_id));
create policy photos_insert on public.route_photos for insert to authenticated
  with check (public.can_work(company_id) and public.order_in_scope(order_id));
create policy photos_update on public.route_photos for update to authenticated
  using (public.can_work(company_id) and public.order_in_scope(order_id))
  with check (public.can_work(company_id) and public.order_in_scope(order_id));
create policy photos_delete on public.route_photos for delete to authenticated
  using (public.can_work(company_id) and public.order_in_scope(order_id));

-- เอกสาร: ธุรการ/บัญชีเห็น · ใบเสนอราคาและหนังสือส่งมอบ = ธุรการ · ใบกำกับภาษี: ธุรการ/บัญชีทำร่าง แต่ออกและยกเลิกได้เฉพาะบัญชี
drop policy if exists documents_select on public.documents;
drop policy if exists documents_write on public.documents;
create policy documents_select on public.documents for select to authenticated using (public.has_any(company_id, '{office,account}'));
create policy documents_insert on public.documents for insert to authenticated with check (
  case when kind = 'rc' then public.has_any(company_id, '{office,account}') and (status = 'draft' or public.has_any(company_id, '{account}'))
       else public.has_any(company_id, '{office}') end);
create policy documents_update on public.documents for update to authenticated
  using (case when kind = 'rc' then public.has_any(company_id, '{office,account}') else public.has_any(company_id, '{office}') end)
  with check (case when kind = 'rc' then public.has_any(company_id, '{office,account}') else public.has_any(company_id, '{office}') end);
create policy documents_delete on public.documents for delete to authenticated
  using (case when kind = 'rc' then public.has_any(company_id, '{office,account}') else public.has_any(company_id, '{office}') end);

create or replace function public.guard_rc_issue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'rc' and new.status is distinct from old.status and new.status in ('issued', 'void')
     and auth.uid() is not null and not public.has_any(new.company_id, '{account}') then
    raise exception 'ออกหรือยกเลิกใบกำกับภาษี/ใบเสร็จได้เฉพาะฝ่ายบัญชีหรือเจ้าของ';
  end if;
  return new;
end $$;
drop trigger if exists documents_rc_issue on public.documents;
create trigger documents_rc_issue before update on public.documents for each row execute function public.guard_rc_issue();

-- รายชื่อลูกจ้าง: ตารางจริงมีค่าแรง เห็น/แก้ได้เฉพาะบัญชี คนอื่นอ่านผ่าน crew_v (ค่าแรงเป็นค่าว่าง)
drop policy if exists crew_select on public.crew;
drop policy if exists crew_write on public.crew;
create policy crew_select on public.crew for select to authenticated using (public.has_any(company_id, '{account}'));
create policy crew_write on public.crew for all to authenticated
  using (public.has_any(company_id, '{account}')) with check (public.has_any(company_id, '{account}'));

drop view if exists public.crew_v;
create view public.crew_v with (security_barrier) as
  select c.id, c.company_id, c.name, c.sort, c.active, c.created_at,
         case when public.has_any(c.company_id, '{account}') then c.wage end as wage
  from public.crew c
  where public.is_member(c.company_id);
revoke all on public.crew_v from anon, public;
grant select on public.crew_v to authenticated;

-- บันทึกรายวัน: ตารางจริงเห็น/แก้/ลบได้เฉพาะบัญชี
-- คนอื่นอ่านผ่าน daily_v: ค่าแรงถูกตัดออก (เห็นเฉพาะบัญชี), น้ำมัน/อื่น ๆ เห็นเฉพาะบัญชีและหัวหน้าชุด, งานเห็นเฉพาะสายในขอบเขต
drop policy if exists daily_all on public.daily_logs;
create policy daily_all on public.daily_logs for all to authenticated
  using (public.has_any(company_id, '{account}')) with check (public.has_any(company_id, '{account}'));

drop view if exists public.daily_v;
create view public.daily_v with (security_barrier) as
  select d.company_id, d.log_date, d.order_id,
         w.work,
         coalesce((select array_agg((x ->> 'r')::uuid) from jsonb_array_elements(w.work) x), '{}') as route_ids,
         case when public.has_any(d.company_id, '{account}') then d.crew
              else coalesce((select jsonb_agg(c - 'wage' - 'ot' order by o) from jsonb_array_elements(d.crew) with ordinality as e (c, o)), '[]'::jsonb) end as crew,
         case when public.has_any(d.company_id, '{account,field}') then d.fuel end as fuel,
         case when public.has_any(d.company_id, '{account,field}') then d.other end as other,
         d.note, d.updated_at
  from public.daily_logs d
  cross join lateral (
    select coalesce(jsonb_agg(x order by o), '[]'::jsonb) as work
    from jsonb_array_elements(d.work) with ordinality as e (x, o)
    where public.route_in_scope((x ->> 'r')::uuid)
  ) w
  where public.is_member(d.company_id);
revoke all on public.daily_v from anon, public;
grant select on public.daily_v to authenticated;

-- บันทึกรายวันผ่านฟังก์ชันนี้เท่านั้น (บัญชีและหัวหน้าชุด)
-- คนที่ไม่ใช่บัญชี: ค่าแรง/OT ใช้ของเดิมหรือจากรายชื่อลูกจ้าง ส่งมาเท่าไรก็ไม่นับ
-- งานของสายที่อยู่นอกขอบเขตของผู้บันทึกจะถูกเก็บไว้เหมือนเดิม
create or replace function public.save_daily(p_company uuid, p_date date, p_work jsonb, p_crew jsonb, p_fuel numeric, p_other numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  acct boolean := public.has_any(p_company, '{account}');
  old public.daily_logs;
  dflt numeric;
  w jsonb;
  c jsonb;
begin
  if not public.has_any(p_company, '{account,field}') then raise exception 'ไม่มีสิทธิ์บันทึกรายวัน'; end if;
  if p_date is null then raise exception 'วันที่ไม่ถูกต้อง'; end if;
  select * into old from public.daily_logs where company_id = p_company and log_date = p_date;

  -- งาน: ของผู้บันทึก (ในขอบเขต) + ของเดิมที่อยู่นอกขอบเขต
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into w
  from (
    select x, o from jsonb_array_elements(coalesce(p_work, '[]'::jsonb)) with ordinality as e (x, o)
    where public.route_in_scope((x ->> 'r')::uuid)
    union all
    select x, 100000 + o from jsonb_array_elements(coalesce(old.work, '[]'::jsonb)) with ordinality as e (x, o)
    where not public.route_in_scope((x ->> 'r')::uuid)
  ) t;

  -- คนงาน
  if acct then
    c := coalesce(p_crew, '[]'::jsonb);
  else
    select coalesce(percentile_disc(0.5) within group (order by k.wage), 0) into dflt
    from public.crew k where k.company_id = p_company and k.active;
    select coalesce(jsonb_agg(
             jsonb_build_object('id', x ->> 'id', 'name', x ->> 'name', 'on', coalesce((x ->> 'on')::boolean, false),
               'wage', coalesce((prev ->> 'wage')::numeric, k.wage, dflt),
               'ot', coalesce((prev ->> 'ot')::numeric, 0))
             order by o), '[]'::jsonb) into c
    from jsonb_array_elements(coalesce(p_crew, '[]'::jsonb)) with ordinality as e (x, o)
    left join lateral (
      select y from jsonb_array_elements(coalesce(old.crew, '[]'::jsonb)) y
      where (coalesce(x ->> 'id', '') <> '' and y ->> 'id' = x ->> 'id') or (coalesce(x ->> 'id', '') = '' and y ->> 'name' = x ->> 'name')
      limit 1
    ) p (prev) on true
    left join public.crew k on k.company_id = p_company and k.id::text = x ->> 'id';
  end if;

  insert into public.daily_logs (company_id, log_date, order_id, work, crew, fuel, other, note, updated_by)
  values (p_company, p_date, case when jsonb_array_length(w) > 0 then null else old.order_id end, w, c,
          coalesce(p_fuel, 0), coalesce(p_other, 0), left(coalesce(p_note, ''), 500), auth.uid())
  on conflict (company_id, log_date) do update set
    order_id = excluded.order_id, work = excluded.work, crew = excluded.crew, fuel = excluded.fuel,
    other = excluded.other, note = excluded.note, updated_by = excluded.updated_by;
end $$;
grant execute on function public.save_daily(uuid, date, jsonb, jsonb, numeric, numeric, text) to authenticated;
revoke execute on function public.save_daily(uuid, date, jsonb, jsonb, numeric, numeric, text) from anon, public;

-- =====================================================================
-- ที่เก็บไฟล์
-- photos/ : ทุกคนในบริษัทดูได้ คนที่ทำงานหน้างานอัป/ลบได้ · logo/ : ทุกคนดูได้
-- อื่น ๆ (ไฟล์ใบสั่งจ้าง ฯลฯ): ธุรการ/บัญชีดูได้ ธุรการอัป/ลบได้
-- =====================================================================
drop policy if exists files_select on storage.objects;
drop policy if exists files_insert on storage.objects;
drop policy if exists files_update on storage.objects;
drop policy if exists files_delete on storage.objects;
drop policy if exists files_delete_photos on storage.objects;

create or replace function public.file_ok(p_name text, p_op text)
returns boolean language sql stable security definer set search_path = '' as $$
  with f as (select (string_to_array(p_name, '/'))[1] as c, (string_to_array(p_name, '/'))[2] as d)
  select exists (
    select 1 from f join public.companies co on co.id::text = f.c
    where case
      when p_op = 'read' and f.d in ('photos', 'logo') then public.is_member(co.id)
      when p_op = 'read' then public.has_any(co.id, '{office,account}')
      when f.d = 'photos' then public.can_work(co.id)
      else public.has_any(co.id, '{office}')
    end);
$$;
grant execute on function public.file_ok(text, text) to authenticated;
revoke execute on function public.file_ok(text, text) from anon, public;

create policy files_select on storage.objects for select to authenticated
  using (bucket_id = 'company-files' and public.file_ok(name, 'read'));
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-files' and public.file_ok(name, 'write'));
create policy files_update on storage.objects for update to authenticated
  using (bucket_id = 'company-files' and public.file_ok(name, 'write'))
  with check (bucket_id = 'company-files' and public.file_ok(name, 'write'));
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-files' and public.file_ok(name, 'write'));

