-- 한국사 보드 전용 가족 동기화 테이블입니다.
-- 실행 전: 기존 투데이보드의 anonymous-family.sql을 이미 실행해
-- public.heeyoon_family_owner()가 준비되어 있어야 합니다.
-- 이 SQL은 기존 테이블/행을 수정하거나 삭제하지 않습니다.
begin;

create table if not exists public.history_progress (
  user_id uuid not null references auth.users(id) on delete restrict,
  field_key text not null check (field_key ~ '^(day|quiz):[0-9]+-[0-9]+$|^(day2|visit):[0-9]+$'),
  value jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, field_key)
);

create or replace function public.history_progress_set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists history_progress_set_updated_at on public.history_progress;
create trigger history_progress_set_updated_at
before update on public.history_progress
for each row execute function public.history_progress_set_updated_at();

alter table public.history_progress enable row level security;
revoke all on public.history_progress from public, anon, authenticated;
grant select, insert, update on public.history_progress to authenticated;

drop policy if exists history_progress_family_read on public.history_progress;
drop policy if exists history_progress_family_insert on public.history_progress;
drop policy if exists history_progress_family_update on public.history_progress;
drop policy if exists history_progress_family_no_delete on public.history_progress;

create policy history_progress_family_read on public.history_progress
for select to authenticated
using (user_id = (select public.heeyoon_family_owner()));
create policy history_progress_family_insert on public.history_progress
for insert to authenticated
with check (user_id = (select public.heeyoon_family_owner()));
create policy history_progress_family_update on public.history_progress
for update to authenticated
using (user_id = (select public.heeyoon_family_owner()))
with check (user_id = (select public.heeyoon_family_owner()));
create policy history_progress_family_no_delete on public.history_progress
as restrictive for delete to authenticated
using (false);

commit;
