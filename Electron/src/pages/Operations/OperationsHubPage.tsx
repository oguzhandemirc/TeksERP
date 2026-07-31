import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  useKursunBypassEnabled,
  useShipmentConfirmationEnabled,
} from "@/hooks/usePricingEnabled";
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
  // "Sevk onayı adımı" kapalıyken (varsayılan) sevkler doğrudan çıkar → "Sevk Kapısı"
  // karosu gizlenir (tile.requiresShipmentConfirmation). Açılınca flag invalidate → geri gelir.
  const shipmentConfirmationEnabled = useShipmentConfirmationEnabled();
  // Kurşun bypass kapalıyken (varsayılan) kurşun tabletten işlenir → "Kurşun
  // Dağıtım" karosu gizlenir. Route açık kalır: dağıtılmış işler bitirilebilsin.
  // AÇIKKEN ise ters yön işler: "Kurşun Sırası" karosu gizlenir (sırayı okuyacak
  // kurşun tableti kalmadı) ve o ekranın ROUTE'u da kapanır.
  const kursunBypassEnabled = useKursunBypassEnabled();

  const visible = operationsTiles.filter((t) => {
    if (t.requiresShipmentConfirmation && !shipmentConfirmationEnabled) return false;
    if (t.requiresKursunBypass && !kursunBypassEnabled) return false;
    if (t.hiddenWhenKursunBypass && kursunBypassEnabled) return false;
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
