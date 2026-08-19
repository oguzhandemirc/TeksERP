import { useEffect, useRef } from "react";
import { toast } from "sonner";

// =============================================================================
// KESME UYARISI — sessizce kırpılan listeyi GÖRÜNÜR yapar (2026-08-19)
// =============================================================================
// Sabit `pageSize`'lı tek-atış picker/lookup sorguları, kayıt sayısı tavanı
// aşınca listeyi SESSİZCE kırpıyor: tavanı aşan kayıt ne picker'da ne istemci
// aramasında görünüyor, hata da çıkmıyor. Operatör "kayıt yok" sanıyor.
//
// ⚠️ Bu hook mobildeki `useTruncationWarning`'in ikizidir ve panelde EŞDEĞERİ
// YOKTU (2026-08-19 denetimi): Electron'daki 20 `pageSize:200/500` çağrısının
// hiçbirinde ne uyarı ne hata vardı; `pagination.total >` karşılaştırması yalnız
// iki yerde geçiyordu ve ikisi de `throw` (picker-loader + Colors/service).
//
// ⚠️ Bu bir ÇÖZÜM DEĞİL, GÖRÜNÜRLÜK katmanıdır. Kalıcı çözüm listeyi sunucu
// aramalı/cursor'lı picker'a taşımaktır (`EntityPickerModal`). Bu uyarı, o işin
// ne zaman gerektiğini söyleyen tetikleyicidir: sahada görülmeye başladığı gün
// o picker dönüştürülür.
//
// ⚠️ "Doğası gereği küçük" listelerde (kalite, istasyon, iade sebebi…) tek atış
// BİLİNÇLİ olarak korunur — onları sunucu aramasına çevirmek yükü ARTIRIR
// (tuş başına sorgu ↔ tek önbellekli çekim). Uyarı orada da durur çünkü
// "doğası gereği küçük" bir varsayımdır ve bir gün yanlış çıkabilir.
// =============================================================================

/** Mount başına bir kez uyarır — her yeniden render'da toast yağmuru olmasın. */
export function useTruncationWarning(
  pagination: { total?: number; pageSize?: number } | undefined,
  label: string,
): void {
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current || !pagination) return;
    const { total, pageSize } = pagination;
    if (typeof total !== "number" || typeof pageSize !== "number") return;
    if (total > pageSize) {
      warned.current = true;
      toast.warning(`${label} listesi eksik gösteriliyor`, {
        description: `${pageSize}/${total} kayıt yüklendi — aradığınız kayıt listede yoksa arama kutusunu kullanın veya yöneticinize bildirin.`,
        duration: 8000,
      });
    }
  }, [pagination, label]);
}
