-- Local PostgreSQL schema สำหรับ dev เครื่องนี้เท่านั้น (ใช้กับ Prisma ผ่าน DATABASE_URL)
-- ตัดส่วนที่พึ่ง Supabase (auth.users, auth.uid(), RLS, storage.*) ออกทั้งหมด
-- เพราะ local Postgres ธรรมดาไม่มีสิ่งเหล่านี้ และ Prisma เชื่อมตรงแบบ bypass RLS อยู่แล้ว
-- อ้างอิงโครงสร้างจาก src/prisma/contract.prisma และ supabase/setup_all.sql

create extension if not exists pgcrypto;

-- เดิมมี public.profiles (คู่กับ auth.users ของ Supabase) — ตอนนี้ auth เขียนเอง
-- เลยรวมเป็นตาราง users ตารางเดียว (เก็บทั้งข้อมูลยืนยันตัวตนและโปรไฟล์)
drop table if exists public.profiles;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
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
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null,
  role text not null default 'staff',
  roles text[] not null default '{field}',
  scope text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_members_user_idx on public.company_members (user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role text not null default 'staff',
  roles text[] not null default '{field}',
  scope text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table if not exists public.agencies (
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
create index if not exists agencies_company_idx on public.agencies (company_id);

create table if not exists public.orders (
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
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, agency_id, round_no, hmd)
);
create index if not exists orders_company_idx on public.orders (company_id, agency_id, round_no);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  seq int not null default 0,
  code text not null default '',
  descr text not null default '',
  area numeric(14, 2) not null default 0 check (area >= 0),
  rate numeric(12, 4) not null default 0 check (rate >= 0),
  done boolean,
  done_date date,
  length_km numeric(10, 3) check (length_km is null or length_km >= 0),
  created_at timestamptz not null default now()
);
create index if not exists routes_order_idx on public.routes (order_id, seq);

create table if not exists public.route_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  route_id uuid not null references public.routes (id) on delete cascade,
  kind text not null check (kind in ('b', 'a')),
  path text not null,
  w int,
  h int,
  taken_date date,
  taken_time text,
  caption text not null default '',
  name text,
  sort int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists route_photos_route_idx on public.route_photos (route_id, kind, sort);
create index if not exists route_photos_order_idx on public.route_photos (order_id);

create table if not exists public.documents (
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
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, no)
);
create index if not exists documents_company_idx on public.documents (company_id, doc_date desc);
create index if not exists documents_order_idx on public.documents (order_id);

create table if not exists public.crew (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  wage numeric(10, 2) not null default 0 check (wage >= 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists crew_company_idx on public.crew (company_id, sort);

create table if not exists public.daily_logs (
  company_id uuid not null references public.companies (id) on delete cascade,
  log_date date not null,
  order_id uuid references public.orders (id) on delete set null,
  route_ids uuid[] not null default '{}',
  crew jsonb not null default '[]'::jsonb,
  fuel numeric(12, 2) not null default 0,
  other numeric(12, 2) not null default 0,
  note text not null default '',
  work jsonb not null default '[]'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, log_date)
);
create index if not exists daily_logs_order_idx on public.daily_logs (order_id);
create index if not exists daily_logs_routes_idx on public.daily_logs using gin (route_ids);

-- touch updated_at ให้เหมือนพฤติกรรมเดิมบน Supabase
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
drop trigger if exists agencies_touch on public.agencies;
create trigger agencies_touch before update on public.agencies for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents for each row execute function public.touch_updated_at();
drop trigger if exists daily_logs_touch on public.daily_logs;
create trigger daily_logs_touch before update on public.daily_logs for each row execute function public.touch_updated_at();

-- ========================================================================
-- ฟังก์ชัน/trigger ที่พอร์ตมาจาก supabase/setup_all.sql แบบคำต่อคำ
-- (เฉพาะตัวที่ไม่ได้อ้าง auth.uid()/auth.jwt() ข้างใน — เป็นแค่ data integrity
-- หรือ business logic ล้วนๆ จึงใช้กับ local Postgres ตรงๆได้โดยไม่ต้องแก้)
-- ========================================================================

-- กันไม่ให้ผูกข้ามบริษัท (แขวงต้องเป็นของบริษัทเดียวกัน, สายทางต้องอยู่บริษัทเดียวกับใบสั่งจ้าง)
create or replace function public.check_same_company()
returns trigger language plpgsql as $$
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
drop trigger if exists orders_same_company on public.orders;
create trigger orders_same_company before insert or update on public.orders for each row execute function public.check_same_company();
drop trigger if exists routes_same_company on public.routes;
create trigger routes_same_company before insert or update on public.routes for each row execute function public.check_same_company();

create or replace function public.check_photo_route()
returns trigger language plpgsql as $$
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
drop trigger if exists route_photos_check on public.route_photos;
create trigger route_photos_check before insert or update on public.route_photos
  for each row execute function public.check_photo_route();

create or replace function public.check_doc_company()
returns trigger language plpgsql as $$
begin
  if new.order_id is not null and not exists (select 1 from public.orders o where o.id = new.order_id and o.company_id = new.company_id) then
    raise exception 'ใบสั่งจ้างนี้ไม่ใช่ของบริษัทนี้';
  end if;
  return new;
end $$;
drop trigger if exists documents_same_company on public.documents;
create trigger documents_same_company before insert or update on public.documents for each row execute function public.check_doc_company();
drop trigger if exists daily_logs_same_company on public.daily_logs;
create trigger daily_logs_same_company before insert or update on public.daily_logs for each row execute function public.check_doc_company();

-- เก็บเฉพาะสายที่เป็นของบริษัทนี้ และ route_ids ตรงกับ work เสมอ
create or replace function public.check_daily_routes()
returns trigger language plpgsql as $$
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

-- กฎเอกสาร: ลบได้เฉพาะฉบับร่าง, ที่ยกเลิกแล้วแก้ไม่ได้, ใบกำกับภาษีที่ออกแล้วแก้ไม่ได้ (ยกเลิกได้อย่างเดียว)
create or replace function public.guard_document()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and exists (select 1 from public.companies c where c.id = old.company_id) then
      raise exception 'ลบได้เฉพาะฉบับร่าง เอกสารที่ออกแล้วให้กดยกเลิกแทน';
    end if;
    return old;
  end if;
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
drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before update or delete on public.documents for each row execute function public.guard_document();

-- ห้ามทำให้บริษัทไม่เหลือเจ้าของ (รุ่น roles[] ตาม 0005_roles.sql)
create or replace function public.keep_one_owner()
returns trigger language plpgsql as $$
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
drop trigger if exists members_keep_owner on public.company_members;
create trigger members_keep_owner before update or delete on public.company_members
  for each row execute function public.keep_one_owner();

-- เลขที่ถัดไป เช่น GQT-69-001 (นับแยกตามประเภทและปี พ.ศ. ของวันที่เอกสาร)
create or replace function public.next_doc_no(p_company uuid, p_kind text, p_date date)
returns text language sql stable as $$
  with p as (
    select (case p_kind when 'qt' then 'GQT' when 'dl' then 'GDL' else 'GRC' end) || '-' ||
           lpad(((extract(year from coalesce(p_date, current_date))::int + 543) % 100)::text, 2, '0') || '-' as pre
  )
  select p.pre || lpad((coalesce(max(substring(d.no from length(p.pre) + 1)::int), 0) + 1)::text, 3, '0')
  from p left join public.documents d on d.company_id = p_company and d.no ~ ('^' || p.pre || '[0-9]+$')
  group by p.pre;
$$;

-- บันทึกใบสั่งจ้างพร้อมสายทางทั้งหมดในครั้งเดียว: สายเดิม (มี id) แก้ในที่เดิม (รูป/สถานะไม่หาย),
-- สายที่ไม่อยู่ในรายการแล้วถูกลบ, สายใหม่เพิ่ม — สร้างใหม่เมื่อ p_id เป็น null
create or replace function public.save_order(p_id uuid, p_company uuid, p_order jsonb, p_routes jsonb)
returns uuid language plpgsql as $$
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
