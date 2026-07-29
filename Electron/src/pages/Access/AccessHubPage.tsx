import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { accessTiles, accessGroups, type AccessTile, type AccessTileGroup } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function AccessHubPage() {
  // Grup → tile (kullanıcı erişimi / cihaz erişimi). Tanımlar hub'ıyla aynı desen.
  const tilesByGroup = new Map<AccessTileGroup, AccessTile[]>();
  for (const tile of accessTiles) {
    const list = tilesByGroup.get(tile.group) ?? [];
    list.push(tile);
    tilesByGroup.set(tile.group, list);
  }

  return (
    <PageShell>
      <PageHeader
        title="Yetkilendirme"
      />
      <PageBody className="flex flex-col gap-8 p-6">
        {accessGroups.map((group) => {
          const groupTiles = tilesByGroup.get(group.key);
          if (!groupTiles || groupTiles.length === 0) return null;

          return (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <group.icon className="h-4 w-4 self-center text-muted-foreground" />
                <h2 className="text-sm font-semibold">{group.title}</h2>
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
      </PageBody>
    </PageShell>
  );
}
