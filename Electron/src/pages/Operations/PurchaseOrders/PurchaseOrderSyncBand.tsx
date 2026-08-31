// =============================================================================
// SİPARİŞ UYARI BANDI — mal kabul yanıtındaki senkron sonucu
// =============================================================================
// ⚠️ TOAST'IN YERİNE DEĞİL, YANINA. Toast birkaç saniyede kaybolur; "sipariş
// miktarı aşıldı" ve "bu ürün siparişte yok" bilgileri ise fişi KAPATAN kişinin
// görmesi gereken şeylerdir — ay sonunda faturayla karşılaştırırken değil.
//
// ⚠️ TON KURALI: fazla kabul BİLGİdir (mavi), eşleşmeyen ürün UYARIdır (amber),
// tamamlanma İYİ HABERdir (yeşil). Hiçbiri KIRMIZI değildir — kırmızı
// "düzeltmen gereken bir şey var" der ve fazla mal gelmesi düzeltilecek bir şey
// değildir.
// =============================================================================
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { receiptSyncNotices, type ReceiptPurchaseOrderSync, type SyncNoticeTone } from "./receiptSync";

const TONE_CLASS: Record<SyncNoticeTone, string> = {
  info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

const TONE_ICON: Record<SyncNoticeTone, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
};

interface Props {
  sync: ReceiptPurchaseOrderSync | null | undefined;
  className?: string;
}

export function PurchaseOrderSyncBand({ sync, className }: Props) {
  const notices = receiptSyncNotices(sync);
  // Sipariş bağı yoksa / uyarı yoksa TEK BAYT çizilmez — serbest mal kabul
  // akışı (ve fabrika) bugünküyle bayt-bayt aynı kalır.
  if (notices.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {notices.map((n, i) => {
        const Icon = TONE_ICON[n.tone];
        return (
          <p
            key={`${n.tone}-${i}`}
            className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs", TONE_CLASS[n.tone])}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{n.text}</span>
          </p>
        );
      })}
    </div>
  );
}
