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

