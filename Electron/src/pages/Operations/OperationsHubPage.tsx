import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { HubSkeleton } from "@/components/hub/HubSkeleton";
import { RelocatedToolsSection } from "@/pages/Reports/_v2/RelocatedTools";
import { operationGroups, operationGroup, type OperationGroupKey } from "./groups-config";
import { useSectionTiles, type VisibleSectionTile } from "./useSectionTiles";

interface Props {
  /** Verilirse yalnız o bölüm (menü kökü sayfası: `/sales` …); verilmezse eski birleşik `/operations`. */
  section?: OperationGroupKey;
}

/**
 * Bölüm kart sayfası. Görünürlük `useSectionTiles`ten (menü alt listesiyle AYNI süzgeç).
 * YÜKLEME ANI: bayraklar gelene dek iskelet — modüllü karo gizlenip sonra BELİRMEZ (titreme sıfır).
 */
export function OperationsHubPage({ section }: Props) {
  const { ready, tiles } = useSectionTiles();
  const groups = section ? [operationGroup(section)] : operationGroups;
  const single = section ? operationGroup(section) : null;

  return (
    <PageShell>
      <PageHeader title={single?.title ?? "Operasyon"} />
      <PageBody className="flex flex-col gap-8 px-4 pb-6 pt-2 md:px-6">
        {!ready ? <HubSkeleton count={9} /> : null}
        {ready &&
          groups.map((group) => {
            const groupTiles = tiles[group.key];
            if (groupTiles.length === 0) return null;
            return (
              <section key={group.key}>
                {single ? null : (
                  <div className="mb-3 flex items-baseline gap-2">
                    <group.icon className="h-4 w-4 self-center text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{group.title}</h2>
                  </div>
                )}
                <SectionGrid tiles={groupTiles} />
              </section>
            );
          })}
        {/* Raporlar v2: rapor menüsünden çıkan iz sürme araçları (bayrak kapalıyken çizilmez). */}
        {ready && (!section || section === "production") ? (
          <RelocatedToolsSection host="/operations" title="İz sürme" />
        ) : null}
      </PageBody>
    </PageShell>
  );
}

function SectionGrid({ tiles }: { tiles: VisibleSectionTile[] }) {
  return (
    <HubGrid>
      {tiles.map((tile, i) => (
        <HubCard
          key={tile.key}
          to={tile.to}
          title={tile.label}
          description={tile.description}
          icon={tile.icon}
          index={i}
          offHint={tile.off ? tile.offHint : undefined}
        />
      ))}
    </HubGrid>
  );
}
