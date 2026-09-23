import { Button } from "@/components/ui/button";
import type { NumberSeriesRow } from "./types";

/**
 * BEKLEYEN DEĞİŞİKLİK + DEVRALINAN ÇAKIŞMA bilgisi (K4, 2026-09-23).
 *
 * ⚠️ Bekleyen satır GÖSTERİLMEZSE kullanıcı aynı tarihe ikinci kez kaydediyor ve
 * ham bir tekillik hatası görüyordu. Vadesi gelmemiş satır bir TASLAKTIR: iptal
 * edilebilir ve iptal YÜRÜRLÜKTEKİ biçime dokunmaz.
 *
 * ⚠️ Çakışma satırı BİLGİDİR, ENGEL DEĞİL: devralınmış bir çakışma (kasa kodu ↔
 * kartela sevk) engellenmiyor, ama bilerek bırakılmış olanla bilmeden bırakılmış
 * olan arasındaki fark söylenmeden kapanmaz.
 */
export function NumberingPendingBlock({
  row,
  busy,
  onCancel,
}: {
  row: NumberSeriesRow;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      {row.pending && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span>
            <span className="font-medium">Bekleyen değişiklik:</span>{" "}
            {new Date(row.pending.effectiveFrom).toLocaleDateString("tr-TR")} itibarıyla{" "}
            <span className="font-mono">{row.pending.preview}</span>
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
            İptal et
          </Button>
        </div>
      )}
      {row.scanOverlapWith && (
        <p className="text-xs text-muted-foreground">
          Bu serinin ön eki okutulan “{row.scanOverlapWith}” serisiyle aynı kod şeklini üretiyor;
          barkod okutmada karışabilir, değiştirmeniz önerilir.
        </p>
      )}
    </>
  );
}
