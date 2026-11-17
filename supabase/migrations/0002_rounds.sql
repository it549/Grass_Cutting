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
