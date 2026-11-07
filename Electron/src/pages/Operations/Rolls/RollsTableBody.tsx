import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { Factory, PanelRight, Recycle, Ruler, Trash2, Truck } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { FilterBar, StandaloneDateRangeFilter } from "@/components/data-table/FilterBar";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { DataTablePagination } from "@/hooks/useDataTable";
import { RollDetailSheet } from "./RollDetailSheet";
import { BulkCancelRollsDialog } from "./BulkCancelRollsDialog";
import { ReworkRollsDialog } from "./ReworkRollsDialog";
import { QuickShipDialog } from "./QuickShipDialog";
import { ShipmentDocDialog } from "@/pages/Operations/Shipments/ShipmentDocDialog";
import { canQuickShip, type QuickShipRoll } from "./quickShipService";
import { canAdjustRollQty } from "./qtyAdjustService";
import { RollQtyAdjustDialog } from "./RollQtyAdjustDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { RollStatusTabKey } from "./service";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { Roll } from "./types";

/**
 * Liste satırı → Hızlı Sevk satırı. Ad alanları listede zaten çözülü geliyor
 * (`ROLL_LIST_INCLUDE`); diyalog ikinci bir istek atmaz.
 */
function toQuickShipRoll(r: Roll): QuickShipRoll {
  return {
    id: r.id,
    barcode: r.barcode,
    qty: Number(r.currentQty),
    width: r.width,
    itemName: r.item?.name ?? "—",
    colorName: r.color?.name ?? null,
    warehouseId: r.warehouseId ?? null,
  };
}

import { DATE_FILTER, useRollFilterDefs } from "./roll-filter-defs";
export { buildRollFilterDefs, DATE_FILTER, KARTELA_MARKED_PARAM } from "./roll-filter-defs";

interface Props {
  tab: RollStatusTabKey;
  /** Tablo örneği + yükleme/sayfalama ÇAĞIRAN'da kurulur (useDataTable). Gövde salt
   *  görünüm: filtre satırı + tablo + detay/iptal diyalogları. */
  table: Table<Roll>;
  isLoading: boolean;
  pagination: DataTablePagination;
  /** true ise dahili filtre satırı çizilmez — çağıran filtreleri kendi araç
   *  çubuğuna (ör. okutma kutusuyla aynı satıra) taşımak istiyor (Kartela). */
  hideFilterBar?: boolean;
  /** Seçili satırların PDF/Excel indirme dosya adı öneki (ör. "Envanter"). Verilmezse
   *  DataTable varsayılanı ("Liste") kullanılır. */
  exportName?: string;
  /** Sayfalama çubuğunun sağına eklenen aksiyonlar ("Tümünü İndir" + "Envanter Özeti"). */
  paginationActions?: ReactNode;
}

/**
 * Rulo tablosunun GÖVDESİ — filtre satırı + DataTable + detay paneli + toplu iptal.
 * Tabloyu kendisi kurmaz (Sütunlar/Görünümler araçlarının konumunu çağıran seçsin
 * diye). Envanter sayfası (RollsPage) ve Kartela ("Kartelada Toplar" sekmesi)
 * tabloyu kendi üst chrome'unda kurup araçları istediği satıra (okut/ara satırı,
 * sekme şeridi vb.) yerleştirir; `hideFilterBar` ile bu gövdenin kendi filtre
 * satırı bastırılabilir.
 */
export function RollsTableBody({
  tab,
  table,
  isLoading,
  pagination,
  hideFilterBar = false,
  exportName,
  paginationActions,
}: Props) {
  const [selected, setSelected] = useState<Roll | null>(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [quickShipOpen, setQuickShipOpen] = useState(false);
  const [shippedId, setShippedId] = useState<string | null>(null);
  // G4 — sayım metraj düzeltmesi (yalnız ticaret rejimi + roll:manual-adjust).
  const [qtyAdjustRoll, setQtyAdjustRoll] = useState<Roll | null>(null);
  const { hasPermission } = useRoleAccess();
  const canManualAdjust = hasPermission("roll:manual-adjust");

  // Depo/emanet/kat seçenekleri kancalardan (tek kaynak `roll-filter-defs`).
  const filters = useRollFilterDefs(tab);

  // Toplu iptal — Ham Stok + Bitmiş Depo'da sunulur (STOCK/WAREHOUSE→CANCELLED,
  // yanlış giriş düzeltmesi). Backend softDelete WAREHOUSE'a izin verir; rezerve
  // topsa çuval/sevkiyattan da çıkarır. Seçili satırlar TanStack table state'inden okunur.
  const selectedRolls = table.getSelectedRowModel().rows.map((r) => r.original);
  // ⚠️ Sekme listeleri AÇIK yazılır, "X değilse" diye NEGATİF kurulmaz: bu gövdeyi
  // Kartela ("Kartelada Toplar") ve Top Arşivi sayfaları da kullanıyor — negatif
  // koşul oralara toplu iptal/üretim butonu sızdırır.
  const bulkCancelable =
    tab === "RAW_STOCK" || tab === "SEMI_FINISHED" || tab === "FINISHED_STOCK";
  /**
   * ÜRETİME AL — seçili topları yeni bir iş emrine sokar (`quick-start`).
   *
   * ⚠️ 2026-08-26'da KARAR DÖNDÜ. Buton eskiden yalnız Bitmiş Depo'daydı ve
   * gerekçesi şuydu: *"Ham Stok'ta gösterilmez, oradaki top zaten üretime
   * girmemiş — normal iş emri açma yolu kullanılır."* O yol masaüstünde YOK:
   * Yeni İş Emri formu top almıyor ve mevcut iş emrine top ekleme ucu
   * 2026-06-12'de kaldırıldı. Yani gizlenen buton, olmayan bir kuralı taklit
   * ediyordu ve ham stoktaki top (özellikle dışarıdan alınan yarı mamul)
   * masaüstünden hiçbir iş emrine bağlanamıyordu.
   *
   * Backend baştan beri üçünü de kabul ediyor: STOCK / WAREHOUSE / A1_STOCK.
   */
  const reworkable =
    tab === "RAW_STOCK" || tab === "SEMI_FINISHED" || tab === "FINISHED_STOCK";
  // Bitmiş depo topu "yeniden" üretime alınır (bir tur görmüş); ham stok ve yarı
  // mamul ilk kez girer. Fark yalnız başlık/ikon/toast metnindedir.
  const reworkMode = tab === "FINISHED_STOCK" ? "rework" : "start";
  // HIZLI SEVK GÖRÜNÜRLÜĞÜ — iki koşul, ikisi de gerekli:
  //  ① Sekme "Bitmiş Depo": sevk edilebilir topların yaşadığı tek sekme. Diğer
  //     sekmelerdeki toplar tanım gereği sevk edilemez (üretimde/fasonda/çuvalda)
  //     ve buton orada sürekli 400 üreten ölü bir yol olurdu.
  //  ② TİCARET REJİMİ (`finance.enabled`): FABRİKADA SIFIR FARK kuralı. Fabrikanın
  //     sevk akışı FİZİKSEL çuval üzerinden yürür (Paketleme/Çuvallar; ihracatta
  //     çuval tartısı zorunlu) — orada "tartısız çuvalı otomatik açan" bir kestirme
  //     yeni bir yol AÇMAK olurdu, mevcut yolu hızlandırmak değil.
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const quickShippable = canQuickShip(tab, financeEnabled);

  return (
    <>
      {/* Filtre satırı — tarih aralığı en başta. */}
      {!hideFilterBar && (
        <FilterBar filters={filters} leading={<StandaloneDateRangeFilter def={DATE_FILTER} />} />
      )}
      <DataTable<Roll>
        table={table}
        isLoading={isLoading}
        pagination={pagination}
        paginationActions={paginationActions}
        emptyText="Top bulunamadı."
        exportName={exportName}
        // Seçim çubuğunda ipucu metni yok (sevkiyat ekranlarıyla tutarlı) — "Seçili
        // PDF/Excel" ve varsa "Stoktan Kaldır" butonları zaten kendini anlatıyor.
        selectionHint={null}
        onRowClick={setSelected}
        // Ham Stok'ta seçim çubuğuna "Stoktan Kaldır" (iptal) — DataTable bunu
        // alt şeride (Seçimi temizle'nin yanına) koyar; ayrı üst şerit yok.
        bulkActions={
          bulkCancelable || reworkable || quickShippable
            ? (rows) =>
                rows.length > 0 ? (
                  <>
                    {/* HIZLI SEVK — "seçtiklerimi gönder". Yalnız Bitmiş Depo
                        sekmesinde + ticaret rejiminde (bkz. yukarıdaki yüklem). */}
                    {quickShippable && (
                      <PermissionGate permission="shipping:write">
                        <Button size="sm" className="gap-1.5" onClick={() => setQuickShipOpen(true)}>
                          <Truck className="h-4 w-4" /> Seçilenleri Sevk Et
                        </Button>
                      </PermissionGate>
                    )}
                    {reworkable && (
                      // İzin `workorder:write` — uç zaten onu kabul ediyor
                      // (`quick-start`). Yeni izin kodu AÇILMADI.
                      <PermissionGate permission="workorder:write">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setReworkOpen(true)}
                        >
                          {reworkMode === "rework" ? (
                            <>
                              <Recycle className="h-4 w-4" /> Yeniden Üretime Al
                            </>
                          ) : (
                            <>
                              <Factory className="h-4 w-4" /> Üretime Al
                            </>
                          )}
                        </Button>
                      </PermissionGate>
                    )}
                    {bulkCancelable && (
                      <PermissionGate permission="roll:write">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1.5"
                          onClick={() => setBulkCancelOpen(true)}
                        >
                          <Trash2 className="h-4 w-4" /> Stoktan Kaldır
                        </Button>
                      </PermissionGate>
                    )}
                  </>
                ) : null
            : undefined
        }
        rowContextMenu={(roll) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(roll)}>
              <PanelRight /> Detayı aç (panel)
            </ContextMenuItem>
            {/* G4 — "Metraj Düzelt" (sayım): YALNIZ ticaret rejiminde çizilir
                (`canAdjustRollQty` yüklemi financeEnabled'ı da içerir, bekçili:
                qtyAdjust.test.ts) + roll:manual-adjust. Fabrika yüzeyi bugünküyle
                birebir — orada metraj istasyon akışının işidir. */}
            {canManualAdjust && canAdjustRollQty(roll, financeEnabled) && (
              <ContextMenuItem onSelect={() => setQtyAdjustRoll(roll)}>
                <Ruler /> Metraj Düzelt (sayım)
              </ContextMenuItem>
            )}
            {roll.barcode && (
              <>
                <ContextMenuSeparator />
                <CopyMenuItem label="Barkod" value={roll.barcode} />
              </>
            )}
          </>
        )}
      />
      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
      <RollQtyAdjustDialog
        roll={qtyAdjustRoll}
        onOpenChange={(open) => !open && setQtyAdjustRoll(null)}
      />
      <BulkCancelRollsDialog
        open={bulkCancelOpen}
        onOpenChange={setBulkCancelOpen}
        rolls={selectedRolls}
        onDone={() => table.resetRowSelection()}
      />
      <ReworkRollsDialog
        open={reworkOpen}
        onOpenChange={setReworkOpen}
        mode={reworkMode}
        rolls={selectedRolls}
        onDone={() => table.resetRowSelection()}
      />
      {/* Koşullu mount: her açılış taze bileşen → seçim `useState` başlangıcı
          olarak girer, prop senkronu (ve onun sonsuz döngü riski) gerekmez. */}
      {quickShipOpen && (
        <QuickShipDialog
          open
          onOpenChange={(open) => {
            setQuickShipOpen(open);
            if (!open) table.resetRowSelection();
          }}
          initialRolls={selectedRolls.map(toQuickShipRoll)}
          onShipped={setShippedId}
        />
      )}
      {/* Sevk sonrası kestirme: irsaliye. Kullanıcı sevk ekranını aramaz —
          kâğıt zaten sevk anında istenen tek şeydir. */}
      <ShipmentDocDialog
        shipmentId={shippedId}
        open={Boolean(shippedId)}
        onOpenChange={(open) => !open && setShippedId(null)}
      />
    </>
  );
}
