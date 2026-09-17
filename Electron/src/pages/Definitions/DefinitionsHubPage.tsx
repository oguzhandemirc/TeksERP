import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { definitionTiles, type DefinitionTile } from "./tile-config";
import { definitionGroups, type DefinitionGroupKey } from "./groups-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { HubSkeleton } from "@/components/hub/HubSkeleton";

export function DefinitionsHubPage() {
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();

  // `isAdmin` kısa devresi KORUNUYOR: admin (admin:users | admin:settings |
  // admin:*) her kartı görür. `permissionAny` taşıyan kartlar için tek tek
  // izin aranır — belge tasarım kartları böyle, çünkü dar izinli kullanıcı
  // (document-template:*) admin DEĞİLDİR ve kısa devreden faydalanamaz.
  const visibilityCtx = useOperationsVisibilityContext();
  const visibleTiles = definitionTiles.filter((t) => {
    // Rejim kuralı İZİNDEN ve admin kısa devresinden ÖNCE: kurulum türü
    // sorusudur, yetki değil — admin de fabrika rejiminde Cariler'i görmez.
    if (t.visibleWhen && !t.visibleWhen(visibilityCtx)) return false;
    if (isAdmin) return true;
    if (t.permissionAny) return hasAnyPermission(t.permissionAny);
    return !t.permission || hasPermission(t.permission);
  });

  const tilesByGroup = new Map<DefinitionGroupKey, DefinitionTile[]>();
  for (const tile of visibleTiles) {
    const list = tilesByGroup.get(tile.group) ?? [];
    list.push(tile);
    tilesByGroup.set(tile.group, list);
  }

  return (
    <PageShell>
      <PageHeader
        title="Tanımlar"
      />
      <PageBody className="flex flex-col gap-8 p-6">
        {/* Bayraklar gelene dek modüllü karo gizlenip sonra BELİRMEZ — iskelet (titreme sıfır). */}
        {!visibilityCtx.flagsReady ? <HubSkeleton count={8} className="xl:grid-cols-4" /> : null}
        {visibilityCtx.flagsReady && definitionGroups.map((group) => {
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
