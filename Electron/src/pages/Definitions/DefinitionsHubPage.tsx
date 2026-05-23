import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { definitionTiles, type DefinitionTile } from "./tile-config";
import { definitionGroups, type DefinitionGroupKey } from "./groups-config";

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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {groupTiles.map((tile) => (
                  <Link key={tile.key} to={tile.to} className="group">
                    <Card className="h-full p-4 transition-colors hover:border-foreground/20 hover:bg-accent/30">
                      <div className="flex items-start justify-between">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
                          <tile.icon className="h-4 w-4" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="mt-4">
                        <div className="font-medium">{tile.title}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tile.description}
                        </p>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
