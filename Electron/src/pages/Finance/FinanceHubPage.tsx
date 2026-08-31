import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { financeTiles } from "./tile-config";

export function FinanceHubPage() {
  // Operasyon hub'ıyla aynı kural: `isAdmin` kısa devresi YOK — kısmi admin,
  // yetkisi olmayan muhasebe kartını görmemeli.
  const { hasAnyPermission } = useRoleAccess();
  const visible = financeTiles.filter((t) => hasAnyPermission(t.permissionAny));

  return (
    <PageShell>
      <PageHeader
        title="Muhasebe"
        description="Cari hesaplar, faturalar, tahsilat/ödeme ve kasa-banka. Bu bir ön muhasebe defteridir — resmî fatura dış programda kesilir, buradaki kayıt onun izini tutar."
      />
      <PageBody className="p-6">
        <HubGrid>
          {visible.map((tile, i) => (
            <HubCard
              key={tile.key}
              to={tile.to}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              tone={tile.tone}
              index={i}
            />
          ))}
        </HubGrid>
      </PageBody>
    </PageShell>
  );
}
