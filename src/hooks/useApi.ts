import { useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useAppAuth } from "@/hooks/useAppAuth";

export function useApi() {
  const { getToken } = useAppAuth();

  const fetchApi = useCallback(
    async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      return apiFetch<T>(path, options, token);
    },
    [getToken]
  );

  return { fetchApi };
}
