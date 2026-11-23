BEGIN;

-- Historical rows have no verified binding and confer no entitlement.
ALTER TABLE public.subscriptions
  ADD COLUMN paddle_binding_verified_at timestamptz,
  ADD COLUMN paddle_last_event_at timestamptz;

CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid uuid,
  check_env text DEFAULT 'live'
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE user_id = user_uuid
      AND environment = check_env
      AND paddle_binding_verified_at IS NOT NULL
      AND status IN ('active', 'trialing')
      AND (current_period_end IS NULL OR current_period_end > now())
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;

COMMIT;
