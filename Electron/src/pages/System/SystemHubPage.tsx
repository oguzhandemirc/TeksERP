import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { systemTiles, systemTileSections } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function SystemHubPage() {
  const { isAdmin } = useRoleAccess();
  const visibleTiles = systemTiles.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sistem" description="Aktivite, ayarlar ve sistem kayıtları." />
      <div className="space-y-8 p-6">
        {systemTileSections.map((section) => {
          const tiles = visibleTiles.filter((t) => t.group === section.group);
          if (tiles.length === 0) return null;
          return (
            <section key={section.group}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  {section.description}
                </p>
              </div>
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
