/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_USER_ACTION_LOG_ENDPOINT?: string;
  readonly VITE_USER_ACTION_LOGGING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
