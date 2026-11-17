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
