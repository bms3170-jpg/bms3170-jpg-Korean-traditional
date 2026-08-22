
-- 철원민통선한과 통합 업그레이드 SQL
create extension if not exists pgcrypto;

alter table public.admin_users add column if not exists role text not null default 'owner';
alter table public.admin_users add column if not exists display_name text not null default '';
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner','maintenance'));

alter table public.store_settings add column if not exists sale_force_closed boolean not null default false;
alter table public.store_settings add column if not exists sale_closed_reason text not null default '';
alter table public.store_settings add column if not exists site_notice text not null default '재고 소진 시 예약판매가 조기 종료될 수 있습니다.';
alter table public.store_settings add column if not exists shipping_fee integer not null default 0;
alter table public.store_settings add column if not exists free_shipping_threshold integer not null default 0;
alter table public.store_settings add column if not exists pickup_info text not null default '';
alter table public.store_settings add column if not exists shipping_info text not null default '';

alter table public.products add column if not exists stock integer;
alter table public.products add column if not exists low_stock_threshold integer not null default 5;
alter table public.products drop constraint if exists products_stock_check;
alter table public.products add constraint products_stock_check check (stock is null or stock >= 0);

alter table public.orders add column if not exists order_number text;
alter table public.orders add column if not exists unit_price integer not null default 0;
alter table public.orders add column if not exists shipping_fee integer not null default 0;
alter table public.orders add column if not exists courier text not null default '';
alter table public.orders add column if not exists tracking_number text not null default '';
alter table public.orders add column if not exists refund_bank text not null default '';
alter table public.orders add column if not exists refund_account text not null default '';
alter table public.orders add column if not exists refund_holder text not null default '';
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists refund_status text not null default 'none';
alter table public.orders add column if not exists refund_reason text not null default '';
alter table public.orders add column if not exists admin_memo text not null default '';
alter table public.orders add column if not exists stock_restored boolean not null default false;
alter table public.orders add column if not exists privacy_agreed_at timestamptz;
alter table public.orders add column if not exists customer_sms_opt_in boolean not null default true;

update public.orders
set order_number='HG-'||to_char(timezone('Asia/Seoul',created_at),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))
where order_number is null or order_number='';
create unique index if not exists orders_order_number_key on public.orders(order_number);
alter table public.orders alter column order_number set not null;

alter table public.orders drop constraint if exists orders_status_check;
update public.orders set status=case when receive='delivery' then 'delivered' else 'picked_up' end where status='completed';
alter table public.orders add constraint orders_status_check check(status in('new','paid','preparing','shipping','delivered','ready_for_pickup','picked_up','cancelled'));
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check(payment_status in('unpaid','paid','refund_pending','refunded'));
alter table public.orders drop constraint if exists orders_refund_status_check;
alter table public.orders add constraint orders_refund_status_check check(refund_status in('none','pending','completed'));

create table if not exists public.notices(
 id uuid primary key default gen_random_uuid(),title text not null,body text not null default '',
 active boolean not null default true,pinned boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.notification_outbox(
 id uuid primary key default gen_random_uuid(),
 channel text not null check(channel in('sms','admin_push')),recipient text not null default '',
 title text not null default '',body text not null,order_id uuid references public.orders(id) on delete set null,
 status text not null default 'pending' check(status in('pending','sending','sent','failed')),
 attempts integer not null default 0,last_error text not null default '',
 created_at timestamptz not null default now(),sent_at timestamptz
);
create table if not exists public.admin_logs(
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete set null,
 action text not null,target_type text not null default '',target_id text not null default '',
 detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admin_users where user_id=auth.uid() and role in('owner','maintenance'));
$$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admin_users where user_id=auth.uid() and role='owner');
$$;

create or replace function public.set_order_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.order_number is null or new.order_number='' then
  new.order_number:='HG-'||to_char(timezone('Asia/Seoul',now()),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 end if; return new;
end; $$;
drop trigger if exists trg_set_order_number on public.orders;
create trigger trg_set_order_number before insert on public.orders for each row execute function public.set_order_number();

create or replace function public.restore_stock_on_cancel()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='cancelled' and old.status is distinct from 'cancelled' and coalesce(new.stock_restored,false)=false then
  update public.products set stock=case when stock is null then null else stock+new.quantity end where id=new.product_id;
  new.stock_restored:=true;
 end if; return new;
end; $$;
drop trigger if exists trg_restore_stock_on_cancel on public.orders;
create trigger trg_restore_stock_on_cancel before update of status on public.orders for each row execute function public.restore_stock_on_cancel();

create or replace function public.queue_order_notifications()
returns trigger language plpgsql security definer set search_path=public as $$
declare msg text;
begin
 if tg_op='INSERT' then
  insert into public.notification_outbox(channel,recipient,title,body,order_id)
  values('admin_push','','새 주문 접수',new.order_number||' / '||new.customer_name||' / '||new.quantity||'개',new.id);
  insert into public.notification_outbox(channel,recipient,title,body,order_id)
  values('sms',new.phone,'철원민통선한과 주문접수','예약주문이 접수되었습니다. 주문번호 '||new.order_number,new.id);
 elsif new.status is distinct from old.status or new.payment_status is distinct from old.payment_status then
  msg:=case
   when new.payment_status='refunded' then '환불이 완료되었습니다.'
   when new.payment_status='refund_pending' then '환불 절차를 진행 중입니다.'
   when new.payment_status='paid' and old.payment_status is distinct from 'paid' then '입금이 확인되었습니다.'
   when new.status='preparing' then '상품 준비를 시작했습니다.'
   when new.status='shipping' then '상품이 발송되었습니다.'||case when new.tracking_number<>'' then ' 송장번호 '||new.tracking_number else '' end
   when new.status='delivered' then '배송 완료 상태입니다.'
   when new.status='ready_for_pickup' then '픽업 준비가 완료되었습니다.'
   when new.status='picked_up' then '수령 완료 처리되었습니다.'
   when new.status='cancelled' then '주문이 취소되었습니다.'
   else null end;
  if msg is not null then
   insert into public.notification_outbox(channel,recipient,title,body,order_id)
   values('sms',new.phone,'철원민통선한과 주문안내',msg||' 주문번호 '||new.order_number,new.id);
  end if;
 end if; return new;
end; $$;
drop trigger if exists trg_queue_order_notifications on public.orders;
create trigger trg_queue_order_notifications after insert or update on public.orders for each row execute function public.queue_order_notifications();

create or replace function public.create_public_order(
 p_product_id uuid,p_quantity integer,p_customer_name text,p_phone text,p_receive text,
 p_address text,p_depositor_name text,p_request text,
 p_refund_bank text,p_refund_account text,p_refund_holder text,p_privacy_agreed boolean
)
returns table(order_number text,total_price integer)
language plpgsql security definer set search_path=public as $$
declare s public.store_settings%rowtype;p public.products%rowtype;v public.orders%rowtype;sub integer;ship integer;today_kst date:=timezone('Asia/Seoul',now())::date;
begin
 select * into s from public.store_settings where id=1;
 if s.id is null or s.sale_start is null or s.sale_end is null or today_kst<s.sale_start or today_kst>s.sale_end then raise exception '현재는 예약판매 기간이 아닙니다.';end if;
 if s.sale_force_closed then raise exception '%',coalesce(nullif(s.sale_closed_reason,''),'예약판매가 조기 종료되었습니다.');end if;
 if p_quantity is null or p_quantity<=0 then raise exception '수량을 확인해 주세요.';end if;
 if trim(coalesce(p_customer_name,''))='' or trim(coalesce(p_phone,''))='' then raise exception '주문자 정보를 확인해 주세요.';end if;
 if p_receive not in('pickup','delivery') then raise exception '수령방법을 확인해 주세요.';end if;
 if p_receive='delivery' and trim(coalesce(p_address,''))='' then raise exception '배송지를 입력해 주세요.';end if;
 if trim(coalesce(p_depositor_name,''))='' then raise exception '입금자명을 입력해 주세요.';end if;
 if trim(coalesce(p_refund_bank,''))='' or trim(coalesce(p_refund_account,''))='' or trim(coalesce(p_refund_holder,''))='' then raise exception '환불계좌 정보를 입력해 주세요.';end if;
 if coalesce(p_privacy_agreed,false)=false then raise exception '개인정보 수집·이용 동의가 필요합니다.';end if;
 if exists(select 1 from public.orders where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and product_id=p_product_id and quantity=p_quantity and status<>'cancelled' and created_at>now()-interval '90 seconds') then raise exception '같은 주문이 방금 접수되었습니다. 주문조회를 확인해 주세요.';end if;
 select * into p from public.products where id=p_product_id and active=true for update;
 if p.id is null then raise exception '판매 중인 상품이 아닙니다.';end if;
 if p.stock is not null and p.stock<p_quantity then raise exception '남은 재고가 부족합니다.';end if;
 sub:=p.price*p_quantity;
 ship:=case when p_receive='delivery' and not(s.free_shipping_threshold>0 and sub>=s.free_shipping_threshold) then s.shipping_fee else 0 end;
 if p.stock is not null then update public.products set stock=stock-p_quantity where id=p.id;end if;
 insert into public.orders(product_id,quantity,customer_name,phone,receive,address,depositor_name,request,unit_price,shipping_fee,total_price,status,refund_bank,refund_account,refund_holder,payment_status,refund_status,privacy_agreed_at)
 values(p.id,p_quantity,trim(p_customer_name),trim(p_phone),p_receive,case when p_receive='delivery' then trim(coalesce(p_address,'')) else '' end,trim(p_depositor_name),trim(coalesce(p_request,'')),p.price,ship,sub+ship,'new',trim(p_refund_bank),trim(p_refund_account),trim(p_refund_holder),'unpaid','none',now())
 returning * into v;
 return query select v.order_number,v.total_price;
end; $$;
revoke all on function public.create_public_order(uuid,integer,text,text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function public.create_public_order(uuid,integer,text,text,text,text,text,text,text,text,text,boolean) to anon,authenticated;

create or replace function public.lookup_order(p_order_number text,p_phone text)
returns table(order_number text,created_at timestamptz,weight text,quantity integer,total_price integer,receive text,address text,status text,courier text,tracking_number text)
language sql stable security definer set search_path=public as $$
 select o.order_number,o.created_at,p.weight,o.quantity,o.total_price,o.receive,o.address,o.status,o.courier,o.tracking_number
 from public.orders o join public.products p on p.id=o.product_id
 where upper(o.order_number)=upper(trim(p_order_number))
 and regexp_replace(o.phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') limit 1;
$$;
revoke all on function public.lookup_order(text,text) from public;
grant execute on function public.lookup_order(text,text) to anon,authenticated;

alter table public.notices enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.admin_logs enable row level security;

drop policy if exists "admins can read own admin row" on public.admin_users;
create policy "admins can read own admin row" on public.admin_users for select to authenticated using(user_id=auth.uid());

drop policy if exists "public can read active notices" on public.notices;
drop policy if exists "staff can manage notices" on public.notices;
create policy "public can read active notices" on public.notices for select to anon,authenticated using(active=true or public.is_staff());
create policy "staff can manage notices" on public.notices for all to authenticated using(public.is_staff()) with check(public.is_staff());

drop policy if exists "staff can read notification outbox" on public.notification_outbox;
drop policy if exists "staff can update notification outbox" on public.notification_outbox;
create policy "staff can read notification outbox" on public.notification_outbox for select to authenticated using(public.is_staff());
create policy "staff can update notification outbox" on public.notification_outbox for update to authenticated using(public.is_staff()) with check(public.is_staff());

drop policy if exists "staff can read admin logs" on public.admin_logs;
create policy "staff can read admin logs" on public.admin_logs for select to authenticated using(public.is_staff());

drop policy if exists "admins can manage store settings" on public.store_settings;
drop policy if exists "staff can manage store settings" on public.store_settings;
create policy "staff can manage store settings" on public.store_settings for all to authenticated using(public.is_staff()) with check(public.is_staff());

drop policy if exists "admins can manage products" on public.products;
drop policy if exists "staff can manage products" on public.products;
create policy "staff can manage products" on public.products for all to authenticated using(public.is_staff()) with check(public.is_staff());

drop policy if exists "admins can read orders" on public.orders;
drop policy if exists "admins can update orders" on public.orders;
drop policy if exists "staff can read orders" on public.orders;
drop policy if exists "staff can update orders" on public.orders;
create policy "staff can read orders" on public.orders for select to authenticated using(public.is_staff());
create policy "staff can update orders" on public.orders for update to authenticated using(public.is_staff()) with check(public.is_staff());

update public.store_settings set site_notice='재고 소진 시 예약판매가 조기 종료될 수 있습니다. 품절 등으로 주문이 취소될 경우 주문 시 입력한 환불계좌로 환불이 진행될 수 있습니다.' where id=1 and(site_notice is null or site_notice='');

-- 유지보수 계정 예시:
-- update public.admin_users set role='maintenance' where user_id='5306bd32-2771-490a-ae85-7ed6a81bbdc5';
-- 운영자 2명:
-- insert into public.admin_users(user_id,role,display_name) values('운영자1_UUID','owner','운영자1');
-- insert into public.admin_users(user_id,role,display_name) values('운영자2_UUID','owner','운영자2');
