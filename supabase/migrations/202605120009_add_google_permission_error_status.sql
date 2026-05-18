alter table public.integrations
  drop constraint if exists integrations_status_check;

alter table public.integrations
  add constraint integrations_status_check check (
    status in (
      'not_connected',
      'connected',
      'syncing',
      'error',
      'disconnected',
      'connected_but_insufficient_permissions',
      'failed_permissions',
      'permission_error',
      'revoked'
    )
  );
