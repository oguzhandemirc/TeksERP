import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { reportTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function ReportsHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  const tiles = reportTiles.filter(
    (t) => isAdmin || !t.permission || hasPermission(t.permission),
  );

  return (
    <PageShell>
      <PageHeader
        title="Raporlar"
      />
      <PageBody className="p-6">
        <HubGrid>
          {tiles.map((tile, i) => (
            <HubCard
              key={tile.key}
              to={tile.to}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              index={i}
            />
          ))}
        </HubGrid>
      </PageBody>
    </PageShell>
  );
}
