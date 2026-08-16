import { useCallback } from "react";
import { apiFetch, type ApiFetchOptions } from "@/lib/api";
import { useAppAuth } from "@/hooks/useAppAuth";

export function useApi() {
  const { getToken } = useAppAuth();

  const fetchApi = useCallback(
    async <T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> => {
      const token = await getToken();
      return apiFetch<T>(path, options, token);
    },
    [getToken]
  );

  return { fetchApi };
}
