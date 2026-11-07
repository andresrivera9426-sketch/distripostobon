-- Simulación mínima de Supabase SOLO para pruebas locales (nunca ejecutar en producción).
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create publication supabase_realtime;
create function public.gen_random_bytes(n int) returns bytea language sql as $$ select decode(substr(md5(random()::text)||md5(random()::text),1,n*2),'hex') $$;
