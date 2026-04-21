import { useAuth } from "@clerk/clerk-react";
import { useCallback } from "react";
import { apiFetch, USE_MOCK } from "@/lib/api";

export function useApi() {
  const { getToken } = useAuth();

  const fetchApi = useCallback(
    async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
      if (USE_MOCK) {
        return apiFetch<T>(path, options, null);
      }
      const token = await getToken();
      return apiFetch<T>(path, options, token);
    },
    [getToken]
  );

  return { fetchApi };
}
