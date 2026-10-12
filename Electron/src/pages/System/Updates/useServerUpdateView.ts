import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { UpdateStatus, UpdateSummary } from "@/types/server-update";
import { useServerUpdateStatus, useServerUpdateSummary } from "../ServerUpdates/hooks";

export interface ServerUpdateView {
  /** Satırı çizen veri: izinliye tam durum (özetin üst kümesi), ötekine özet. */
  summary: UpdateSummary | undefined;
  /** Yalnız lisans izni olana — onay düğmeleri ve Ayrıntılar'ın sunucu kartları. */
  full: UpdateStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  canManage: boolean;
}

/** Tam durum `license:view ∨ license:manage` ister; izni olmayana yalnız `/ozet` sorulur (iki uç birden değil). */
export function useServerUpdateView(): ServerUpdateView {
  const { hasPermission } = useRoleAccess();
  const canManage = hasPermission("license:manage");
  const canRead = canManage || hasPermission("license:view");
  const full = useServerUpdateStatus(canRead);
  const summary = useServerUpdateSummary(!canRead);
  const q = canRead ? full : summary;
  return {
    summary: q.data,
    full: full.data,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
    canManage,
  };
}
