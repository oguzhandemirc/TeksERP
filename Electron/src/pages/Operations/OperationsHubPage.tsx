import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useHubOrder } from "@/hooks/useHubOrder";
import { operationsTiles } from "./tile-config";
import { SortableHubGrid, type SortableHubTile } from "@/components/hub/SortableHubGrid";

// İstasyon/akış anlamına göre ton — Kurşun Sırası PROCESS_QC, Toplar depo vb.
const TILE_TONES: Record<string, string> = {
  orders: "text-info",
  "work-orders": "text-primary",
  "product-balance": "text-station-fason",
  rolls: "text-station-depo",
  "kursun-queue": "text-station-process",
  shipments: "text-success",
};

export function OperationsHubPage() {
  // Y6 fix: isAdmin bypass'ı kaldırıldı — kısmi admin (örn. yalnız admin:users)
  // yetkisi olmayan operasyon kartlarını artık görmez (tıklayınca 403 yerine).
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const visible = operationsTiles.filter((t) =>
    t.permissionAny
      ? hasAnyPermission(t.permissionAny)
      : !t.permission || hasPermission(t.permission),
  );

  // Kullanıcının kayıtlı sırasını uygula (yeni/izin kazanılan kart sona eklenir).
  const { ordered, reorder } = useHubOrder(
    "operations",
    visible.map((t) => t.key),
  );
  const byKey = new Map(visible.map((t) => [t.key, t]));
  const tiles: SortableHubTile[] = ordered
    .map((k) => byKey.get(k))
    .filter((t): t is (typeof visible)[number] => Boolean(t))
    .map((t) => ({
      key: t.key,
      to: t.to,
      title: t.title,
      description: t.description,
      icon: t.icon,
      tone: TILE_TONES[t.key],
    }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Operasyon"
        description="Üretim ve lojistik akışını izle, kritik adımlarda müdahale et. Kartları köşedeki tutamaçtan (⠿) sürükleyerek dilediğin sıraya diz — sıra hesabına kaydedilir."
      />
      <div className="p-6">
        <SortableHubGrid tiles={tiles} onReorder={reorder} />
      </div>
    </div>
  );
}
