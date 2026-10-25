// e-İrsaliye sorguları + ayar ekranı bağlantısı. Hazırlık sorusu sunucudadır; panel
// yalnız okur. Readiness 404/403 → kart hiç çizilmez (eski backend / izinsiz kullanıcı).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { EIRSALIYE_READ, EIRSALIYE_READINESS_ACCESS, EIRSALIYE_UNDO, EIRSALIYE_WRITE } from "@/lib/permissions";
import { SETTINGS_CATEGORIES, settingsCategoryPath, settingsCategoryTrail } from "@/pages/GeneralSettings/settings-config";
import { eIrsaliyeService } from "./service";

export const EIRSALIYE_READINESS_KEY = ["eirsaliye", "readiness"] as const;
export const eIrsaliyeShipmentKey = (shipmentId: string) => ["eirsaliye", "shipment", shipmentId] as const;
export const EIRSALIYE_RECORDS_KEY = "eirsaliye-records";

/** Ayar ekranının menü yolu + adresi — kayıttan türer, elle yazılmaz. */
export function eIrsaliyeSettingsLink(): { trail: string; path: string } {
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === "e-irsaliye");
  if (!cat) return { trail: "Sistem", path: "/system" };
  return { trail: settingsCategoryTrail(cat), path: settingsCategoryPath(cat) };
}

export function useEIrsaliyePermissions() {
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  return {
    canRead: hasPermission(EIRSALIYE_READ),
    canReadiness: hasAnyPermission(EIRSALIYE_READINESS_ACCESS),
    canWrite: hasPermission(EIRSALIYE_WRITE),
    canUndo: hasPermission(EIRSALIYE_UNDO),
  };
}

export function useEIrsaliyeReadiness(enabled: boolean) {
  return useQuery({
    queryKey: EIRSALIYE_READINESS_KEY,
    queryFn: eIrsaliyeService.readiness,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useShipmentEIrsaliye(shipmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: eIrsaliyeShipmentKey(shipmentId),
    queryFn: () => eIrsaliyeService.byShipment(shipmentId),
    enabled,
    retry: false,
  });
}

/** Eylem sonrası tazele: kart, liste rozeti ve kayıtlar sayfası. */
export function useEIrsaliyeRefresh(shipmentId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: eIrsaliyeShipmentKey(shipmentId) });
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    void qc.invalidateQueries({ queryKey: [EIRSALIYE_RECORDS_KEY] });
  };
}
