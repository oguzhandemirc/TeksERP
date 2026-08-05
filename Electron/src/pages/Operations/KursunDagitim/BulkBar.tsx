import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatNumber } from "@/lib/format";
import type { HeaderCheckState } from "./selection";

interface Props {
  /** Sekmedeki TÜM satır sayısı (başlık kutusunun kapsamı). */
  totalCount: number;
  selectedCount: number;
  /** Seçili satırların toplam metrajı — "ne kadar mal taşıyorum" sorusu. */
  selectedMeters: number;
  headerState: HeaderCheckState;
  onToggleAll: () => void;
  onClear: () => void;
  disabled: boolean;
  /** Seçim varken görünen aksiyonlar (ata / taşı / havuza al). */
  actions: ReactNode;
}

/**
 * Sekme başındaki SABİT çubuk: "tümünü seç" kutusu + seçim özeti + toplu
 * aksiyonlar.
 *
 * ÇUBUK HER ZAMAN ÇİZİLİR (seçim yokken de) — yalnız aksiyonlar gizlenir.
 * Gerekçe: aksiyon çıktığında çubuğun kendisi belirirse liste aşağı kayar ve
 * operatörün tıklamak üzere olduğu satır ayağının altından gider. Sabit yükseklik,
 * seçim yaparken listenin oynamamasını garanti eder.
 *
 * Seçim SAYISI ve METRAJI birlikte yazılır: "12 seçili" tek başına kaç metre mal
 * bir makineye yığıldığını söylemez, ve dağıtım kararı metraja bakar.
 */
export function BulkBar({
  totalCount,
  selectedCount,
  selectedMeters,
  headerState,
  onToggleAll,
  onClear,
  disabled,
  actions,
}: Props) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="bg-muted/30 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-1.5">
      {/* Kutu YALNIZ "hepsi seçili" olduğunda işaretlidir.
          Radix `indeterminate` durumu BİLİNÇLİ kullanılmadı: paylaşılan
          `Checkbox` bileşeninin göstergesi hem `checked` hem `indeterminate`
          için AYNI tik ikonunu basıyor — yani "bazıları seçili" hâli ekranda
          "hepsi seçili" gibi görünürdü. Kısmi seçim bilgisini yandaki
          "N seçili · M m" metni zaten net veriyor; tıklama davranışı
          `toggleAll`'da (hepsi seçiliyse bırak, değilse eksikleri ekle). */}
      <Checkbox
        checked={headerState === "all"}
        onCheckedChange={onToggleAll}
        disabled={disabled || totalCount === 0}
        aria-label="Tümünü seç"
      />

      {hasSelection ? (
        <>
          <span className="text-sm font-medium tabular-nums">
            {selectedCount} seçili
            <span className="text-muted-foreground font-normal">
              {" "}
              · {formatNumber(selectedMeters, 0)} m
            </span>
          </span>

          <div className="flex flex-wrap items-center gap-2">{actions}</div>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto gap-1"
            onClick={onClear}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
            Seçimi bırak
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground text-xs">
          {totalCount === 0
            ? "Bu listede iş yok"
            : "Toplu işlem için satırları işaretleyin"}
        </span>
      )}
    </div>
  );
}
