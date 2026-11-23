import { PageHeader } from "@/components/layout/PageHeader";
import { screenTitle } from "@/components/layout/screen-title";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard } from "@/components/hub/HubCard";
import { HubSubgroups } from "@/components/hub/HubSubgroups";
import { layoutSubgroups } from "@/components/layout/nav-subgroups";
import { financeTiles } from "./tile-config";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isHubTileHidden } from "@/lib/menu-layout";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";

export function FinanceHubPage() {
  // Operasyon hub'ıyla aynı kural: `isAdmin` kısa devresi YOK — kısmi admin,
  // yetkisi olmayan muhasebe kartını görmemeli.
  const { hasAnyPermission } = useRoleAccess();
  const menu = useMenuLayout();
  const ctx = useOperationsVisibilityContext();
  const visible = financeTiles.filter((t) => hasAnyPermission(t.permissionAny) && (!t.visibleWhen || t.visibleWhen(ctx)) && !isHubTileHidden(menu, t.to));

  return (
    <PageShell>
      <PageHeader
        title={screenTitle("/finance")}
        description="Cari hesaplar, faturalar, tahsilat/ödeme ve kasa-banka. Bu bir ön muhasebe defteridir — resmî fatura dış programda kesilir, buradaki kayıt onun izini tutar."
      />
      <PageBody className="p-6">
        <HubSubgroups
          groups={layoutSubgroups("/finance", visible, ctx)}
          renderCard={(tile, i) => (
            <HubCard
              key={tile.key}
              to={tile.to}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              tone={tile.tone}
              index={i}
            />
          )}
        />
      </PageBody>
    </PageShell>
  );
}
