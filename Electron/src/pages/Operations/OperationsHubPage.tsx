import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "./useOperationsVisibility";
import { operationsTiles, type OperationsTile } from "./tile-config";
import { operationGroups, type OperationGroupKey } from "./groups-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

// İstasyon/akış anlamına göre ton — verilmeyen kartlar grup içinde palet tonunu alır.
const TILE_TONES: Record<string, string> = {
  orders: "text-info",
  "work-orders": "text-primary",
  "product-balance": "text-station-fason",
  rolls: "text-station-depo",
  "kursun-queue": "text-station-process",
  "kursun-dagitim": "text-station-process",
  shipments: "text-success",
};

export function OperationsHubPage() {
  // Y6 fix: isAdmin bypass'ı kaldırıldı — kısmi admin, yetkisiz operasyon kartını görmez.
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  // Karo görünürlüğünün bağlı olduğu çalışma anı durumu — kural karoların yanında
  // (`tile-config.ts` → `visibleWhen`), bağlamın kurulumu tek yerde
  // (`useOperationsVisibilityContext`; komut paleti de aynısını kullanır).
  //
  // YÜKLEME ANI BİLİNÇLİ: sayaçlar gelene kadar 0 kabul edilir, yani davranış saf
  // bayrak kuralına düşer. Alternatif (veri gelene kadar hiç çizmemek) hub'ın her
  // açılışında karoların geç gelmesi/titremesi demekti; eksik kalan karo saniyeler
  // içinde kendiliğinden belirir ve bu, menüde kabul edilebilir tek yönlü hatadır.
  const visibilityCtx = useOperationsVisibilityContext();

  const visible = operationsTiles.filter((t) => {
    if (t.visibleWhen && !t.visibleWhen(visibilityCtx)) return false;
    return t.permissionAny
      ? hasAnyPermission(t.permissionAny)
      : !t.permission || hasPermission(t.permission);
  });

  const byGroup = new Map<OperationGroupKey, OperationsTile[]>();
  for (const t of visible) {
    const list = byGroup.get(t.group) ?? [];
    list.push(t);
    byGroup.set(t.group, list);
  }

  return (
    <PageShell>
      <PageHeader
        title="Operasyon"
      />
      <PageBody className="flex flex-col gap-8 p-6">
        {operationGroups.map((group) => {
          const groupTiles = byGroup.get(group.key);
          if (!groupTiles || groupTiles.length === 0) return null;
          return (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <group.icon className="h-4 w-4 self-center text-muted-foreground" />
                <h2 className="text-sm font-semibold">{group.title}</h2>
              </div>
              <HubGrid>
                {groupTiles.map((tile, i) => (
                  <HubCard
                    key={tile.key}
                    to={tile.to}
                    title={tile.title}
                    description={tile.description}
                    icon={tile.icon}
                    tone={TILE_TONES[tile.key]}
                    index={i}
                  />
                ))}
              </HubGrid>
            </section>
          );
        })}
      </PageBody>
    </PageShell>
  );
}
