// =============================================================================
// 1. ADIM — PARAYI SEÇ
// =============================================================================
// Kapama HER ZAMAN tek bir kaynaktan yapılır (tahsilat XOR çek — uçta da öyle).
// Bu yüzden liste çoklu seçim DEĞİL, radyo davranışı taşır: seçili satır
// çerçevesiyle belli olur, ikinci satıra basmak birinciyi bırakır.
//
// ⚠️ Satırlar `<button>` — `<div onClick>` DEĞİL. Klavyeyle gezilebilirlik ve
// odak halkası bedavaya gelir; eldivenli kullanıcı için dokunma alanı da tam
// satır boyunca olur.
import { Button } from "@/components/ui/button";
import { money, type Currency } from "../service";
import { fromKurus } from "./allocationMath";
import type { SourceItem } from "./useAllocationSources";
import type { Direction, SourceKind } from "./service";

interface Props {
  items: SourceItem[];
  isLoading: boolean;
  /**
   * ⚠️ HATA, BOŞ LİSTE DEĞİLDİR. İkisi aynı kutuya düşerse ekran "bu carinin
   * serbest tahsilatı yok" der ve bu KENDİNDEN EMİN bir YALAN olur: uç 403
   * (izin yok / ön muhasebe modülü kapalı) ya da 500 vermiş olabilir. Toast
   * kaybolur, ekrandaki cümle kalır ve kullanıcı olmayan bir kaydı aramaya
   * başlar.
   */
  isError: boolean;
  kind: SourceKind;
  direction: Direction;
  currency: Currency;
  selectedId: string | null;
  onKindChange: (kind: SourceKind) => void;
  onSelect: (item: SourceItem) => void;
}

export function SourcePicker({
  items,
  isLoading,
  isError,
  kind,
  direction,
  currency,
  selectedId,
  onKindChange,
  onSelect,
}: Props) {
  const paymentLabel = direction === "IN" ? "Tahsilat" : "Ödeme";

  return (
    <div className="flex min-h-0 flex-col rounded-md border">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="text-sm font-semibold">1. Parayı seç</span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={kind === "PAYMENT" ? "default" : "outline"}
            onClick={() => onKindChange("PAYMENT")}
          >
            {paymentLabel}
          </Button>
          <Button
            size="sm"
            variant={kind === "CHEQUE" ? "default" : "outline"}
            onClick={() => onKindChange("CHEQUE")}
          >
            Çek / Senet
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Liste alınamadı — bu bir "kayıt yok" cevabı DEĞİLDİR. Ön muhasebe modülü
            kapalı olabilir ya da bu hesapta görüntüleme yetkisi bulunmayabilir.
            Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {/* Boş liste "bozuk" değil: ya para hiç girilmemiş ya da tamamı zaten
                bir faturaya bağlanmış. İkisi çok farklı sonuçlar doğurur, bu
                yüzden ikisi de yazılır. */}
            {kind === "PAYMENT"
              ? `Bu cari ve para biriminde faturaya bağlanmamış ${paymentLabel.toLowerCase()} yok. Ya hiç kayıt girilmemiş ya da tamamı kapamada kullanılmış.`
              : "Bu cari ve para biriminde kapamaya uygun çek/senet yok. Karşılıksız, iade ve iptal çekler bu listede görünmez."}
          </div>
        ) : (
          items.map((it) => {
            const selected = it.id === selectedId;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onSelect(it)}
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{it.docNo}</span>
                  <span className="text-sm font-medium">{money(fromKurus(it.freeKurus), currency)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {it.subtitle} · {it.dateLabel}
                  </span>
                  {/* Kısmen kullanılmış kaynakta "kalan" ile "tutar" ayrı
                      söylenir; yalnız kalanı göstermek "tahsilatı yanlış girmişim"
                      şüphesi doğuruyordu. */}
                  {it.freeKurus !== it.amountKurus && (
                    <span className="shrink-0">
                      Belge: {money(fromKurus(it.amountKurus), currency)}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
