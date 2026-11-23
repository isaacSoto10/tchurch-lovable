-- Run subscription lookups with the caller's existing subscriptions RLS policy.
-- The service role can still reconcile events using its server-only credential.
BEGIN;
ALTER FUNCTION public.has_active_subscription(uuid, text) SECURITY INVOKER;
ALTER FUNCTION public.has_active_subscription(uuid, text) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;
COMMIT;
