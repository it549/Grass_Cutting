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
