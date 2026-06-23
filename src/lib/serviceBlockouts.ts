import { getServiceDateKey } from "./serviceDates";

export interface ServiceBlockoutLike {
  startDate?: string | null;
  endDate?: string | null;
}

export function serviceDateOverlapsBlockout(serviceDate: string, blockout: ServiceBlockoutLike) {
  const serviceKey = getServiceDateKey(serviceDate);
  const startKey = getServiceDateKey(blockout.startDate);
  const endKey = getServiceDateKey(blockout.endDate);

  if (!serviceKey || !startKey || !endKey) return false;

  return startKey <= serviceKey && endKey >= serviceKey;
}

export function hasLocalServiceBlockoutConflict(serviceDate: string, blockouts: ServiceBlockoutLike[]) {
  return blockouts.some((blockout) => serviceDateOverlapsBlockout(serviceDate, blockout));
}
