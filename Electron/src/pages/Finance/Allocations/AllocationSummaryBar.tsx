// =============================================================================
// ALT BANT — "ne kadarı dağıtıldı, ne kadarı kaldı" + tek yazma düğmesi
// =============================================================================
// ⚠️ ENGEL SEBEBİ YAZILI SÖYLENİR. Sadece pasif bir düğme göstermek, eldivenli
// bir kullanıcıyı "bozuk" sonucuna götürür ve destek çağrısı üretir; sebebi
// yazmak aynı yerde çözümü de gösterir ("soldan tahsilat seçin").
//
// ⚠️ RAKAMLAR ÖNİZLEMEDİR. Kapamayı yazan ve aşımı reddeden taraf backend'dir
// (ham atomik UPDATE + DB CHECK). Buradaki hesap yalnız kesin reddedilecek bir
// gönderimi önler; "409 hiç olmaz" GARANTİSİ DEĞİLDİR — başka biri aynı anda
// aynı faturayı kapatabilir ve o durumda uç haklı olarak reddeder.
//
// ⚠️ KAPAMA CARİ BAKİYEYİ DEĞİŞTİRMEZ ve bant bunu açıkça söyler. Bakiye zaten
// iki kez oynadı: faturanın ONAYINDA ve tahsilatın KAYDINDA. Burada değişen tek
// şey "hangi fatura hâlâ açık" sorusunun cevabıdır. "Bakiye düşecek" izlenimi
// veren bir metin, muhasebeciyi aynı parayı ikinci kez aramaya iter.
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { money, type Currency } from "../service";
import { fromKurus } from "./allocationMath";

interface Props {
  currency: Currency;
  /** Seçili belgenin kapamaya kalan tutarı (kuruş). Seçim yoksa 0. */
  freeKurus: number;
  /** Satırlara yazılmış toplam (kuruş). */
  distributedKurus: number;
  invoiceCount: number;
  /** Neden gönderilemiyor — `null` ise düğme açık. */
  blockReason: string | null;
  isPending: boolean;
  onSubmit: () => void;
  onClear: () => void;
}

export function AllocationSummaryBar({
  currency,
  freeKurus,
  distributedKurus,
  invoiceCount,
  blockReason,
  isPending,
  onSubmit,
  onClear,
}: Props) {
  const remaining = freeKurus - distributedKurus;

  return (
    <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          Belgenin kalanı:{" "}
          <span className="font-medium text-foreground">{money(fromKurus(freeKurus), currency)}</span>
        </span>
        <span className="text-muted-foreground">
          Dağıtılan:{" "}
          <span className="font-medium text-foreground">
            {money(fromKurus(distributedKurus), currency)}
          </span>{" "}
          ({invoiceCount} fatura)
        </span>
        <span className="text-muted-foreground">
          Dağıtılmayan:{" "}
          <span className={`font-medium ${remaining < 0 ? "text-destructive" : "text-foreground"}`}>
            {money(fromKurus(remaining), currency)}
          </span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {blockReason ? (
          <span className="text-xs text-muted-foreground">{blockReason}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Kapama yalnız eşleşmedir — cari bakiye ve kasa DEĞİŞMEZ.
          </span>
        )}
        <Button variant="outline" size="sm" disabled={invoiceCount === 0} onClick={onClear}>
          Tutarları temizle
        </Button>
        <PermissionGate permission="finance:payment">
          <Button disabled={Boolean(blockReason) || isPending} onClick={onSubmit}>
            {isPending
              ? "Kaydediliyor…"
              : `Faturaları kapat (${invoiceCount} · ${money(fromKurus(distributedKurus), currency)})`}
          </Button>
        </PermissionGate>
      </div>
    </div>
  );
}
