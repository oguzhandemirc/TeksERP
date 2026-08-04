// =============================================================================
// TOP ARŞİVİ — emekli topların salt-okunur listesi
// =============================================================================
// 2026-08-05'te Envanter sekme şeridinden BURAYA taşındı (kullanıcı talebi:
// "arşiv oradan kalksın, kimsenin tıklamayacağı zor bulunan bir yere koyalım").
//
// NEDEN SİLİNMEDİ, TAŞINDI: bu sayfa dört emekli statünün Electron'daki TEK
// liste yüzeyidir (RETURNED_FROM_SUBCONTRACTOR / TAMBUR_CONSUMED /
// SUBCONTRACTOR_CONSUMED / KARTELA_CONSUMED). Sekme kaldırılıp yerine bir şey
// konmasaydı o topları görmenin yolu barkod okutmaktan ibaret kalırdı — ve
// bir kısmı barkodsuz (fason dönüşü açık kumaş) olduğu için onlara o yoldan da
// ulaşılamazdı. "Zor bulunsun" ile "erişilemesin" farklı şeyler.
//
// KONUM SEÇİMİ: Sistem hub'ı, sidebar'da yalnız admin'e görünen tek daldır ve
// alt sayfaları zaten `admin:settings` ile kilitli — yani yeni bir izin kodu
// açmadan hedefe ulaşıldı (kök CLAUDE.md: "yeni izin = sahada atanması
// unutulacak bir adım daha"). ⚠️ Yan etki BİLİNÇLİ: eskiden `roll:read` ile
// arşive bakabilen depo/üretim personeli artık bakamaz.
// =============================================================================

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { useDataTable } from "@/hooks/useDataTable";
import { rollColumns } from "@/pages/Operations/Rolls/columns";
import { RollsTableBody } from "@/pages/Operations/Rolls/RollsTableBody";
import {
  rollService,
  buildRollForceFilters,
  rollTabDefaultSortBy,
} from "@/pages/Operations/Rolls/service";
import type { Roll } from "@/pages/Operations/Rolls/types";

export default function RollArchivePage() {
  const dataTable = useDataTable<Roll>({
    queryKey: "rolls:ARCHIVE",
    queryKeyParts: ["rolls", "ARCHIVE"],
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    // Statü kümesi TEK KAYNAKTAN gelir (STATUS_GROUPS.ARCHIVE) — buraya elle
    // statü listesi kopyalamak, kümenin zamanla ayrışması demekti.
    forceFilters: buildRollForceFilters("ARCHIVE"),
    // "Buraya geliş ≠ oluşturma": emekli top haftalar önce yaratılmış olabilir,
    // arşive DÜŞTÜĞÜ an `updatedAt`tir. Envanter sekmeleriyle aynı sözleşme.
    defaultSortBy: rollTabDefaultSortBy("ARCHIVE"),
    initialVisibility: {
      subcontractorCategory: false,
      subcontractor: false,
      updatedAt: true,
      createdAt: false,
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Top Arşivi"
        description="Emekli toplar — kesilmiş, fasonda tüketilmiş, kartelaya dönüşmüş ve fason dönüşü kayıtları. Salt okunur."
      />
      <RollsTableBody
        tab="ARCHIVE"
        table={dataTable.table}
        isLoading={dataTable.query.isLoading}
        pagination={dataTable.pagination}
        exportName="Top-Arsivi"
      />
    </PageShell>
  );
}
