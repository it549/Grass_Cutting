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
