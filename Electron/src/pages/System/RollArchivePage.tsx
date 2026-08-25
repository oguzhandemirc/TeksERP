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
// ⚠️ 2026-08-25 — İPTAL + FİRE DE BURADA. `STATUS_GROUPS.ARCHIVE`e `CANCELLED`
// ve `SCRAP` eklendi. Öncesinde iptal edilen top HİÇBİR yüzeyde görünmüyordu:
// envanter sekmeleri ölü statüleri listelemez, arşiv de yalnız dört "tüketilmiş"
// statüyü taşıyordu. "Soft delete — kayıt denetim için korunur" sözü veri
// düzeyinde tutuluyordu ama kayda ULAŞMANIN YOLU YOKTU. Sayfaya ARAMA kutusu
// da bu yüzden eklendi: 200+ satırlık bir arşivde barkodu bilinen tek bir kaydı
// gözle taramak gerçek bir kullanım değil.
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
import { useTableExportAll } from "@/hooks/useTableExportAll";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
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

  // Arşiv salt-okunur ama DIŞA AKTARILABİLİR olmalı: emekli toplar denetim/analiz
  // sorularının asıl kaynağıdır (kesim geçmişi, fasonda tüketilen, kartelaya giden).
  const exportAll = useTableExportAll({
    table: dataTable.table,
    fetchAll: dataTable.fetchAll,
    name: "Top-Arsivi",
  });

  return (
    <PageShell>
      <PageHeader
        title="Top Arşivi"
        description="Emekli toplar — iptal edilmiş, fire edilmiş, kesilmiş, fasonda tüketilmiş, kartelaya dönüşmüş ve fason dönüşü kayıtları. Salt okunur."
      />
      {/* Arama: barkod TAM eşleşir (unique index seek), kumaş/renk adı ve müşteri
          alias'ı `contains`. "Kayıt Türü" filtresiyle birlikte kullanılır. */}
      <DataTableToolbar
        search={dataTable.search}
        onSearchChange={dataTable.setSearch}
        placeholder="Barkod, kumaş veya renk ara..."
        hideSearch={false}
      />
      <RollsTableBody
        tab="ARCHIVE"
        table={dataTable.table}
        isLoading={dataTable.query.isLoading}
        pagination={dataTable.pagination}
        exportName="Top-Arsivi"
        paginationActions={
          <ExportMenu
            label="Tümünü İndir"
            busyLabel={exportAll.busyLabel}
            onPdf={exportAll.onPdf}
            onExcel={exportAll.onExcel}
            onCsv={exportAll.onCsv}
          />
        }
      />
    </PageShell>
  );
}
