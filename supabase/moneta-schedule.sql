-- Reliable schedule for the Moneta sync: Supabase calls the dashboard's
-- sync route every 30 minutes. The route itself skips calls so it runs every
-- 30 min from 6am to midnight Central and every 3 hours overnight.
--
-- Before running: replace PASTE_CRON_SECRET_HERE with the CRON_SECRET value
-- (same as in Vercel / .env.local). Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Supabase Vault rather than in the job text.
delete from vault.secrets where name = 'moneta_cron_secret';
select vault.create_secret('PASTE_CRON_SECRET_HERE', 'moneta_cron_secret');

select cron.unschedule('moneta-sync') where exists (select 1 from cron.job where jobname = 'moneta-sync');
select cron.schedule(
  'moneta-sync',
  '*/30 * * * *',
  $$
  select net.http_get(
    url := 'https://nano-market-dashboard.vercel.app/api/cron/moneta-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'moneta_cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $$
);
