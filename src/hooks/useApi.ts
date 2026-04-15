import { useAuth } from "@clerk/clerk-react";
import { useCallback } from "react";
import { apiFetch } from "@/lib/api";

export function useApi() {
  const { getToken } = useAuth();

  const fetchApi = useCallback(
    async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      console.log("[useApi] Token:", token ? "present" : "MISSING", "length:", token?.length);
      return apiFetch<T>(path, options, token);
    },
    [getToken]
  );

  return { fetchApi };
}