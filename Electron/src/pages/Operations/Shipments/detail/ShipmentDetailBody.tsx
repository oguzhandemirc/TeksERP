import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Package, SearchX } from "lucide-react";
import type { ShipmentDetail } from "../types";
import { ShipmentDetailMeta } from "./ShipmentDetailMeta";
import { ShipmentDetailToolbar } from "./ShipmentDetailToolbar";
import { SackRow } from "./SackRow";
import { useShipmentDetailFilter } from "./useShipmentDetailFilter";

/**
 * Sevkiyat tam-sayfa detay gövdesi — dikey akış: ince özet + kompakt künye + katlanır
 * sipariş/iade (ShipmentDetailMeta) → sabit araç çubuğu (arama/facet/çip/sayaç) →
 * SANALLAŞTIRILMIŞ çuval listesi (kendi overflow-auto'su, flex-1). Bir sevkiyatta
 * ~300 çuval · ~3000 top olabildiğinden liste @tanstack/react-virtual ile çizilir:
 * yalnız görünen satırlar DOM'a girer; satırlar açılınca ResizeObserver ile yeniden ölçülür.
 * Tüm veri tek sorguda (getShipmentById) gelir; filtre/sıralama istemci tarafında ANINDA.
 */
export function ShipmentDetailBody({ d }: { d: ShipmentDetail }) {
  const f = useShipmentDetailFilter(d);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = f.filteredSacks;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Kapalı satır ~40px; AÇIK satır başlık+tablo başlığı + top sayısı×satır + (süzgeç
    // kapalıysa) kartelalar. Açık satırı gerçekçi tahmin etmek, ekran-DIŞI otomatik-açık
    // çuvallarda toplam yüksekliğin başta doğru olmasını sağlar → kaydırma sıçramaz.
    estimateSize: (index) => {
      const entry = rows[index];
      if (!entry || !f.isOpen(entry.sack.id)) return 40;
      const swatchRows = f.isFiltering ? 0 : entry.sack.swatches.length;
      return 74 + entry.rolls.length * 26 + (swatchRows > 0 ? 12 + swatchRows * 18 : 0);
    },
    overscan: 8,
    getItemKey: (index) => rows[index]?.sack.id ?? String(index),
  });

  // Bulk aç/kapa veya süzgeç değişince ekran-DIŞI satırların önbelleklenmiş yüksekliği
  // bayatlar; measure() önbelleği temizler → estimateSize (açıklığa duyarlı) yeniden
  // uygulanır, görünür satırlar ResizeObserver ile netleşir.
  useEffect(() => {
    virtualizer.measure();
  }, [f.openSignature, virtualizer]);

  const noSacks = d.sacks.length === 0;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 py-4">
      <ShipmentDetailMeta d={d} />

      {noSacks ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Package className="h-4 w-4" /> Bu sevkiyatta top yok.
        </div>
      ) : (
        // Araç çubuğu (sabit başlık) + kayan liste TEK panel kartı → özet kartıyla
        // görsel olarak eş, sayfayla bütünleşik kurumsal blok.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <ShipmentDetailToolbar f={f} />
          {rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <SearchX className="h-5 w-5" /> Aramaya/filtreye uyan top yok.
            </div>
          ) : (
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-2">
              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((vi) => {
                  const entry = rows[vi.index];
                  if (!entry) return null;
                  const { sack, rolls } = entry;
                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full pb-1.5"
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <SackRow
                        sack={sack}
                        rolls={rolls}
                        open={f.isOpen(sack.id)}
                        isFiltering={f.isFiltering}
                        onToggle={() => f.toggleOpen(sack.id)}
                        sort={f.sortOf(sack.id)}
                        onSort={(field) => f.toggleSort(sack.id, field)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
