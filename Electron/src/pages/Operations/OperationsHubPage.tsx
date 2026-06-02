import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { operationsTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

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
  const { isAdmin, hasPermission } = useRoleAccess();
  const tiles = operationsTiles.filter(
    (t) => isAdmin || !t.permission || hasPermission(t.permission),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Operasyon"
        description="Üretim ve lojistik akışını izle, kritik adımlarda müdahale et."
      />
      <div className="p-6">
        <HubGrid>
          {tiles.map((tile, i) => (
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
      </div>
    </div>
  );
}
