-- Additive Kvitansiya schema. Existing project objects are untouched.
create extension if not exists pgcrypto with schema extensions;

create table public.kv_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  created_at timestamptz not null default now()
);

create table public.kv_receipt_counter (
  singleton boolean primary key default true check (singleton),
  last_number integer not null default 0 check (last_number >= 0)
);
insert into public.kv_receipt_counter(singleton,last_number) values (true,0);

create table public.kv_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  number integer not null unique check (number > 0),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  paid_at timestamptz not null default now(),
  payer_name text not null check (char_length(btrim(payer_name)) between 2 and 160),
  child_name text not null check (char_length(btrim(child_name)) between 2 and 160),
  phone text check (phone is null or char_length(phone) between 7 and 30),
  purpose text not null check (purpose in ('Sinov mashgʻuloti','1-oy toʻlovi','2-oy toʻlovi','3-oy toʻlovi','Boshqa')),
  purpose_other text check (purpose_other is null or char_length(btrim(purpose_other)) between 2 and 160),
  amount bigint not null check (amount > 0),
  currency text not null default 'UZS' check (currency = 'UZS'),
  method text not null check (method in ('Naqd','Karta','Click','Payme','Bank oʻtkazmasi')),
  contract_no text check (contract_no is null or char_length(contract_no) <= 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  constraint kv_cancel_fields_consistent check (
    (status='active' and cancel_reason is null and cancelled_at is null and cancelled_by is null)
    or (status='cancelled' and char_length(btrim(cancel_reason)) between 3 and 500 and cancelled_at is not null and cancelled_by is not null)
  ),
  constraint kv_other_purpose_consistent check (
    (purpose='Boshqa' and purpose_other is not null) or (purpose<>'Boshqa' and purpose_other is null)
  )
);
create index kv_receipts_paid_at_idx on public.kv_receipts(paid_at desc);
create index kv_receipts_payer_idx on public.kv_receipts(lower(payer_name),created_at desc);

create table public.kv_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  call_count integer not null check (call_count >= 1)
);

create or replace function public.kv_is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.kv_admins a where a.user_id=(select auth.uid())); $$;

create or replace function public.kv_guard_receipt_mutation()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op='DELETE' then raise exception 'Kvitansiyalar oʻchirilmaydi'; end if;
  if row(new.id,new.number,new.code,new.paid_at,new.payer_name,new.child_name,new.phone,new.purpose,new.purpose_other,new.amount,new.currency,new.method,new.contract_no,new.created_by,new.created_at)
     is distinct from
     row(old.id,old.number,old.code,old.paid_at,old.payer_name,old.child_name,old.phone,old.purpose,old.purpose_other,old.amount,old.currency,old.method,old.contract_no,old.created_by,old.created_at) then
    raise exception 'Kvitansiya maʼlumotlarini oʻzgartirib boʻlmaydi';
  end if;
  if old.status<>'active' or new.status<>'cancelled' or new.cancel_reason is null
     or char_length(btrim(new.cancel_reason))<3 or new.cancelled_at is null or new.cancelled_by is null then
    raise exception 'Faqat faol kvitansiyani bekor qilish mumkin';
  end if;
  return new;
end; $$;
create trigger kv_receipts_immutable before update or delete on public.kv_receipts
for each row execute function public.kv_guard_receipt_mutation();

create or replace function public.kv_create_receipt(
 p_payer_name text,p_child_name text,p_phone text,p_purpose text,p_purpose_other text,
 p_amount bigint,p_method text,p_contract_no text,p_paid_at timestamptz)
returns setof public.kv_receipts language plpgsql volatile security definer set search_path=''
as $$
declare v_number integer; v_code text; v_id uuid; v_i integer; v_alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
 if not public.kv_is_admin() then raise exception 'Ruxsat yoʻq' using errcode='42501'; end if;
 if p_payer_name is null or char_length(btrim(p_payer_name)) not between 2 and 160 or p_child_name is null or char_length(btrim(p_child_name)) not between 2 and 160 then raise exception 'F.I.Sh. maydonlarini tekshiring' using errcode='22023'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Summa notoʻgʻri' using errcode='22023'; end if;
 if p_paid_at is null or p_paid_at>now() then raise exception 'Toʻlov sanasi kelajakda boʻlishi mumkin emas' using errcode='22023'; end if;
 if p_purpose not in ('Sinov mashgʻuloti','1-oy toʻlovi','2-oy toʻlovi','3-oy toʻlovi','Boshqa') or p_method not in ('Naqd','Karta','Click','Payme','Bank oʻtkazmasi') then raise exception 'Toʻlov maʼlumotlari notoʻgʻri' using errcode='22023'; end if;
 if p_purpose='Boshqa' and char_length(btrim(coalesce(p_purpose_other,''))) not between 2 and 160 then raise exception 'Boshqa maqsadni yozing' using errcode='22023'; end if;
 update public.kv_receipt_counter set last_number=last_number+1 where singleton=true returning last_number into v_number;
 if v_number is null then raise exception 'Raqamlagich topilmadi'; end if;
 loop
  v_code:='';
  for v_i in 1..10 loop v_code:=v_code||substr(v_alphabet,(get_byte(extensions.gen_random_bytes(1),0)%length(v_alphabet))+1,1); end loop;
  exit when not exists(select 1 from public.kv_receipts r where r.code=v_code);
 end loop;
 insert into public.kv_receipts(number,code,paid_at,payer_name,child_name,phone,purpose,purpose_other,amount,method,contract_no,created_by)
 values(v_number,v_code,p_paid_at,btrim(p_payer_name),btrim(p_child_name),nullif(btrim(coalesce(p_phone,'')),''),p_purpose,case when p_purpose='Boshqa' then btrim(p_purpose_other) else null end,p_amount,p_method,nullif(btrim(coalesce(p_contract_no,'')),''),(select auth.uid())) returning id into v_id;
 return query select * from public.kv_receipts where id=v_id;
end; $$;

create or replace function public.kv_cancel_receipt(p_receipt_id uuid,p_reason text)
returns public.kv_receipts language plpgsql volatile security definer set search_path=''
as $$
declare v_row public.kv_receipts;
begin
 if not public.kv_is_admin() then raise exception 'Ruxsat yoʻq' using errcode='42501'; end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then raise exception 'Bekor qilish sababini kiriting' using errcode='22023'; end if;
 update public.kv_receipts set status='cancelled',cancel_reason=btrim(p_reason),cancelled_at=now(),cancelled_by=(select auth.uid()) where id=p_receipt_id and status='active' returning * into v_row;
 if not found then raise exception 'Kvitansiya topilmadi yoki allaqachon bekor qilingan' using errcode='P0002'; end if;
 return v_row;
end; $$;

create or replace function public.kv_mask_words(p_name text,p_child boolean default false)
returns text language sql immutable set search_path=''
as $$
select case when coalesce(p_child,false) then
 coalesce((select string_agg(upper(left(w,1))||'.','' order by n) from unnest(regexp_split_to_array(btrim(coalesce(p_name,'')),'\s+')) with ordinality as t(w,n) where w<>''),'')
else coalesce((select string_agg(upper(left(w,1))||'***',' ' order by n) from (select w,n from unnest(regexp_split_to_array(btrim(coalesce(p_name,'')),'\s+')) with ordinality as t(w,n) where w<>'' order by n limit 2) s),'') end;
$$;

create or replace function public.kv_verify(p_code text)
returns table(number integer,paid_at timestamptz,amount bigint,currency text,purpose text,status text,payer_masked text,child_initials text)
language plpgsql volatile security definer set search_path=''
as $$
declare v_headers jsonb; v_ip text; v_hash text; v_calls integer;
begin
 v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_ip:=split_part(coalesce(v_headers->>'cf-connecting-ip',v_headers->>'x-real-ip',v_headers->>'x-forwarded-for','unknown'),',',1);
 v_hash:=encode(extensions.digest(v_ip,'sha256'),'hex');
 insert into public.kv_rate_limits(ip_hash,window_started_at,call_count) values(v_hash,now(),1)
 on conflict(ip_hash) do update set window_started_at=case when public.kv_rate_limits.window_started_at<now()-interval '1 minute' then now() else public.kv_rate_limits.window_started_at end,
 call_count=case when public.kv_rate_limits.window_started_at<now()-interval '1 minute' then 1 else public.kv_rate_limits.call_count+1 end returning call_count into v_calls;
 delete from public.kv_rate_limits where window_started_at<now()-interval '1 day';
 if v_calls>20 or p_code is null or p_code !~ '^[A-HJ-NP-Z2-9]{10}$' then return; end if;
 return query select r.number,r.paid_at,r.amount,r.currency,case when r.purpose='Boshqa' then r.purpose_other else r.purpose end,r.status,
 public.kv_mask_words(r.payer_name,false),public.kv_mask_words(r.child_name,true) from public.kv_receipts r where r.code=p_code limit 1;
end; $$;

alter table public.kv_admins enable row level security;
alter table public.kv_receipts enable row level security;
alter table public.kv_receipt_counter enable row level security;
alter table public.kv_rate_limits enable row level security;
create policy kv_admins_self_select on public.kv_admins for select to authenticated using(user_id=(select auth.uid()));
create policy kv_receipts_admin_select on public.kv_receipts for select to authenticated using(public.kv_is_admin());
revoke all on public.kv_admins,public.kv_receipts,public.kv_receipt_counter,public.kv_rate_limits from anon,authenticated;
grant select on public.kv_admins,public.kv_receipts to authenticated;
revoke all on function public.kv_is_admin() from public,anon;
grant execute on function public.kv_is_admin() to authenticated;
revoke all on function public.kv_create_receipt(text,text,text,text,text,bigint,text,text,timestamptz) from public,anon;
grant execute on function public.kv_create_receipt(text,text,text,text,text,bigint,text,text,timestamptz) to authenticated;
revoke all on function public.kv_cancel_receipt(uuid,text) from public,anon;
grant execute on function public.kv_cancel_receipt(uuid,text) to authenticated;
revoke all on function public.kv_mask_words(text,boolean) from public,anon,authenticated;
revoke all on function public.kv_verify(text) from public;
grant execute on function public.kv_verify(text) to anon,authenticated;

-- Add the invited owner's Auth UUID after the Auth account exists:
-- INSERT INTO public.kv_admins(user_id,full_name) VALUES ('[MENING AUTH USER UUID]'::uuid,'Jamshidali Tillavoldiyev');
