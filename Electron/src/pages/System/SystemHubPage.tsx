import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { systemTiles, systemTileSections } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function SystemHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  // Karo ile route AYNI kapıyı kullanır: `permission` taşıyan karo yalnız o izne
  // sahip kullanıcıya görünür, yoksa varsayılan `admin:settings` kapısı geçerli
  // (Sistem hub'ı zaten onun arkasında). Ayrışırsa kart görünür ama sayfa açılmaz.
  const visibleTiles = systemTiles.filter((t) => {
    if (t.adminOnly && !isAdmin) return false;
    if (t.permission) return hasPermission(t.permission);
    return true;
  });

  return (
    <PageShell>
      <PageHeader title="Sistem" />
      <PageBody className="space-y-8 p-6">
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
      </PageBody>
    </PageShell>
  );
}
