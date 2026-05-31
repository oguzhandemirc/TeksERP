import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { definitionTiles, type DefinitionTile } from "./tile-config";
import { definitionGroups, type DefinitionGroupKey } from "./groups-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function DefinitionsHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();

  const visibleTiles = definitionTiles.filter(
    (t) => isAdmin || !t.permission || hasPermission(t.permission),
  );

  const tilesByGroup = new Map<DefinitionGroupKey, DefinitionTile[]>();
  for (const tile of visibleTiles) {
    const list = tilesByGroup.get(tile.group) ?? [];
    list.push(tile);
    tilesByGroup.set(tile.group, list);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tanımlar"
        description="Sistemde kullanılan ana tanım kümeleri. İstediğin gruba tıklayarak detayına git."
      />
      <div className="flex flex-col gap-8 p-6">
        {definitionGroups.map((group) => {
          const groupTiles = tilesByGroup.get(group.key);
          if (!groupTiles || groupTiles.length === 0) return null;

          return (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <group.icon className="h-4 w-4 self-center text-muted-foreground" />
                <h2 className="text-sm font-semibold">{group.title}</h2>
                <span className="text-xs text-muted-foreground">
                  {group.description}
                </span>
              </div>
              <HubGrid className="xl:grid-cols-4">
                {groupTiles.map((tile, i) => (
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
