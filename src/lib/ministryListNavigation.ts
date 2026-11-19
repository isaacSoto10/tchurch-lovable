export const MINISTRY_LIST_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Míos" },
  { value: "pending", label: "Pendientes" },
] as const;

type MinistryListFilter = (typeof MINISTRY_LIST_FILTERS)[number]["value"];

export function ministryListFilter(value: string | null): MinistryListFilter {
  return MINISTRY_LIST_FILTERS.find((filter) => filter.value === value)?.value ?? "all";
}

export function ministryListQuery(search: string, filter: MinistryListFilter) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (filter !== "all") params.set("filter", filter);
  const query = params.toString();
  return query ? `?${query}` : "";
}
