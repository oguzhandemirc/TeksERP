import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { reportTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function ReportsHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  // ⚠️ REJİM KAPISI, İZİN KAPISINDAN AYRI ve İKİSİ DE GEREKLİ. Aşağıdaki izin
  // süzgeci `isAdmin ||` ile kısa devre yapıyor → `report:finance` taşımayan bir
  // ADMİN bile "Ön Muhasebe" karosunu görürdü ve tıklayınca üç ucun üçü de
  // `requireFinanceEnabled` ile 403 dönerdi (sebebi ekranda yazmaz).
  // Bayrak yüklenene kadar `false`: modülü OLMAYAN bir kurulumda karoyu bir an
  // için göstermek, olan kurulumda bir an geç göstermekten kötüdür.
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const tiles = reportTiles.filter(
    (t) =>
      (isAdmin || !t.permission || hasPermission(t.permission)) &&
      (!t.featureFlag || (t.featureFlag === "financeEnabled" && financeEnabled)),
  );

  return (
    <PageShell>
      <PageHeader
        title="Raporlar"
      />
      <PageBody className="p-6">
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
      </PageBody>
    </PageShell>
  );
}
