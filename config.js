// config.js
//
// Paste your Supabase project's URL and anon (public) key here — see
// README.md Part 1 for where to find them (Project Settings > API) after
// running supabase/migration.sql in the SQL Editor.
//
// The anon key is DESIGNED to be public/client-side-visible — it only
// identifies the Postgres role "anon", which (per the SQL migration) has
// zero direct table access (RLS denies it) and EXECUTE only on 5 specific
// RPC functions. Never put the "service_role" key here; that one bypasses
// RLS entirely and must never leave the Supabase dashboard.

const SUPABASE_URL = 'https://ebolduegdfgvtzwopqgz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib2xkdWVnZGZndnR6d29wcWd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODc1NDEsImV4cCI6MjEwMjE2MzU0MX0.muHQJK2HTyRtm3FKDogzxbOb3jj0mWNdQrigm0FFMXk';
