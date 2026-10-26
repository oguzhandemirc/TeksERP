import { PageHeader } from "@/components/layout/PageHeader";
import { TERIM_AD } from "@/lib/terim";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { HubSkeleton } from "@/components/hub/HubSkeleton";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { documentTiles, type DocumentTile } from "./tile-config";

/** Belgeler kökü (UX-2 K2) — karolar Tanımlar'ın eski "Çıktılar" grubu; adresler `/definitions/...` olarak kalır. */
export function DocumentsHubPage() {
  // Tanımlar hub'ıyla aynı izin kuralı (yönetici kısa devresi dahil) — karolar oradan taşındı, görünürlük değişmez.
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const permitted = (t: DocumentTile) =>
    isAdmin || (t.permissionAny ? hasAnyPermission(t.permissionAny) : !t.permission || hasPermission(t.permission));
  const isOff = (t: DocumentTile) => Boolean(t.visibleWhen && !t.visibleWhen(ctx));
  const visible = documentTiles.filter((t) => permitted(t) && (!isOff(t) || Boolean(t.offHint)));
  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.belgeler}
        description="Etiketler, belge şablonları ve tasarımcısı, serbest belgeler, refakat kartı"
      />
      <PageBody className="p-4 sm:p-6">
        {!ctx.flagsReady ? <HubSkeleton count={7} /> : (
          <HubGrid className="xl:grid-cols-4">
            {visible.map((tile, i) => (
              <HubCard
                key={tile.key}
                to={tile.to}
                title={tile.title}
                description={tile.description}
                icon={tile.icon}
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
