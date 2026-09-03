import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { reportTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function ReportsHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  // ⚠️ REJİM KAPISI, İZİN KAPISINDAN AYRI ve İKİSİ DE GEREKLİ. Aşağıdaki izin
  // süzgeci `isAdmin ||` ile kısa devre yapıyor → `report:finance` taşımayan bir
  // ADMİN bile "Ön Muhasebe" karosunu görürdü ve tıklayınca üç ucun üçü de
  // `requireFinanceEnabled` ile 403 dönerdi (sebebi ekranda yazmaz).
  //
  // ⚠️ 2026-09-03: karar artık KARO BAĞLAMINDAN okunuyor, `useFeatureFlags`ten
  // DEĞİL. Eski satır `?? false` ile TEK bir bayrağa gömülüydü; üretim raporları
  // bağlandığında o varsayılan YANLIŞ yöne düşerdi (`production.enabled` backend
  // varsayılanı AÇIK) ve fabrikada karolar bir an kaybolup geri gelirdi. Yön
  // bilgisi tek yerde yaşar: `useOperationsVisibilityContext`.
  const ctx = useOperationsVisibilityContext();
  const tiles = reportTiles.filter(
    (t) =>
      (isAdmin || !t.permission || hasPermission(t.permission)) &&
      (!t.featureFlag || ctx[t.featureFlag]),
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
