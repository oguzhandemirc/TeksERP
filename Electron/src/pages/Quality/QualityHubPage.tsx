import { PageHeader } from "@/components/layout/PageHeader";
import { TERIM_AD } from "@/lib/terim";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { HubSkeleton } from "@/components/hub/HubSkeleton";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { qualityTiles, type QualityTile } from "./tile-config";

/** Kalite Güvence kökü (UX-2 K1) — Operasyon hub'ıyla aynı kural: izin şart, kapalı modül karosu soluk + ipucu. */
export function QualityHubPage() {
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const permitted = (t: QualityTile) =>
    t.permissionAny ? hasAnyPermission(t.permissionAny) : !t.permission || hasPermission(t.permission);
  const isOff = (t: QualityTile) => Boolean(t.visibleWhen && !t.visibleWhen(ctx));
  const visible = qualityTiles.filter((t) => permitted(t) && (!isOff(t) || Boolean(t.offHint)));
  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.kaliteGuvence}
        description="4 puan muayeneleri, lab testleri, sertifikalar ve muayene raporu"
      />
      <PageBody className="p-4 sm:p-6">
        {!ctx.flagsReady ? <HubSkeleton count={5} /> : (
          <HubGrid>
            {visible.map((tile, i) => (
              <HubCard
                key={tile.key}
                to={tile.to}
                title={tile.title}
                description={tile.description}
                icon={tile.icon}
                tone="text-station-kk1"
                index={i}
                offHint={isOff(tile) ? tile.offHint : undefined}
              />
            ))}
          </HubGrid>
        )}
      </PageBody>
    </PageShell>
  );
}
