// =============================================================================
// SAYIMI TAMAMLA — YIKICI İŞLEM, SOMUT ONAY
// =============================================================================
// Kök kural: yıkıcı işlemin onayı ETKİLENEN HER KAYDI somut listeler; "N kayıt
// etkilenecek" gibi soyut bir sayı YETMEZ. Bu yüzden diyalog üç listeyi de tek
// tek basar:
//   ① KAYITTAN DÜŞÜLECEK toplar — barkod + ürün/renk + metraj
//   ② DEFTERE YAZILACAK iplik farkları — kalem + beklenen → sayılan + fark
//   ③ MUHTEMELEN ATLANACAK satırlar — sebebiyle (öngörü)
// Dördüncü blok listelemez ama SAYAR: dokunulmayacaklar (bulundu + sayılmadı).
// Sayılmamış satırın ne olacağı, tam da bu ekranda cevaplanması gereken sorudur.
//
// ⚠️ TERMİNAL. Tamamlanmış sayım iptal edilemez; geri alma yolu kendi ters
// kayıtlarıdır (topta "iptali geri al", iplikte ters ADJUST). Diyalog bunu
// gizlemez — kullanıcı geri dönüşü olmayan bir kapıdan geçtiğini bilerek geçer.
//
// ⚠️ LİSTE BİR VAAT DEĞİL ÖNGÖRÜDÜR ve bu AÇIKÇA yazılır. Fotoğraf ile bu an
// arasında top sevk edilmiş / taşınmış / çuvala girmiş olabilir; son kararı
// backend tx-içi TAZE claim ile verir ve atlanan satırı sebebiyle tutanağa
// yazar. "Kesin şunlar silinecek" demek, uydurulmuş bir kesinlik olurdu.
//
// ⚠️ SAYFANIN VERİSİ YÜKLENMEDEN ONAY AÇILMAZ (`CancelPurchaseOrderDialog`
// emsali): neyi tamamladığını görmeden tamamlamak yok.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { completeStockCount, type StockCountDetail } from "./service";
import {
  completeBlockReason,
  completeButtonLabel,
  completionScope,
  qty,
} from "./stockCountRules";

interface Props {
  count: StockCountDetail;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

export function CompleteStockCountDialog({ count, onOpenChange, onCompleted }: Props) {
  const qc = useQueryClient();
  const scope = completionScope(count.lines);
  const blocked = completeBlockReason(count.status, scope, count.lines.length);

  const completeM = useMutation({
    mutationFn: () => completeStockCount(count.id),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.countNo} tamamlandı.`);
      // Fark fişi ÜÇ deftere birden dokunur: toplar (envanter), iplik bakiyesi
      // ve sayımın kendi kaydı. Dar invalidate ekranın bir yarısını bayat
      // bırakır (kullanıcı tamamlandı rozetini görür, stok eski kalır).
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      void qc.invalidateQueries({ queryKey: ["stock-count", count.id] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      onOpenChange(false);
      onCompleted();
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Sayımı tamamla — fark fişi yazılacak</DialogTitle>
          <DialogDescription>
            <b className="font-mono">{count.countNo}</b> · {count.warehouse.name}. Bu adım GERİ
            ALINAMAZ: eksik işaretli toplar kayıttan düşülür (“mal fiziksel olarak yoktu” kaydı —
            fire DEĞİL), iplik farkları deftere işler ve sayım tutanağı donar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {blocked && (
            <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{blocked}</span>
            </p>
          )}

          {/* ① KAYITTAN DÜŞÜLECEKLER — tek tek, barkoduyla. */}
          {scope.missing.length > 0 && (
            <section className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <h3 className="text-sm font-semibold text-destructive">
                Kayıttan düşülecek toplar — {scope.missing.length} top · {qty(scope.missingMeters)} m
              </h3>
              <ul className="mt-2 max-h-52 space-y-1 overflow-auto text-xs">
                {scope.missing.map((m) => (
                  <li key={m.lineId} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">
                      <span className="font-mono">{m.barcode ?? "barkodsuz"}</span> · {m.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{qty(m.qty)} m</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ② İPLİK FARKLARI — yön işareti METİNDE (renk tek başına yetmez). */}
          {scope.yarnDiffs.length > 0 && (
            <section className="rounded-md border p-3">
              <h3 className="text-sm font-semibold">
                Deftere yazılacak iplik farkları — {scope.yarnDiffs.length} kalem
              </h3>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                {scope.yarnDiffs.map((y) => (
                  <li key={y.lineId} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">
                      {y.itemName}
                      {y.itemCode ? <span className="ml-1 font-mono text-muted-foreground">{y.itemCode}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {qty(y.expectedKg)} → {qty(y.countedKg)} kg (
                      {y.diffKg > 0 ? "+" : "−"}
                      {qty(Math.abs(y.diffKg))})
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ③ ATLANACAK ADAYLARI — sessiz atlama yok. */}
          {scope.outOfScope.length > 0 && (
            <section className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Muhtemelen atlanacak — {scope.outOfScope.length} satır
              </h3>
              <p className="mt-1 text-[11px] text-amber-900/80 dark:text-amber-200/80">
                Eksik işaretli ama bu sırada durumu değişmiş toplar. Kayıttan DÜŞÜLMEZLER; sebepleri
                tutanağa yazılır.
              </p>
              <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs">
                {scope.outOfScope.map((o) => (
                  <li key={o.lineId} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">
                      <span className="font-mono">{o.barcode ?? "barkodsuz"}</span> · {o.label}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{o.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ④ DOKUNULMAYACAKLAR — "sayılmadı" ile "eksik" farkının cevabı. */}
          <section className="rounded-md bg-muted/40 p-3 text-xs">
            <h3 className="text-sm font-semibold">Dokunulmayacaklar</h3>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>{scope.foundRolls} top bulundu olarak işaretli — kayıtta kalır.</li>
              <li>
                <b>{scope.uncountedRolls} top hiç sayılmadı</b> — eksik SAYILMAZ, kayıttan
                düşülmez. (Yarım sayım tamamlanabilir; sayılmayanlar olduğu gibi kalır.)
              </li>
              <li>{scope.uncountedYarn} iplik kalemi sayılmadı — bakiyesine dokunulmaz.</li>
            </ul>
          </section>

          <p className="text-[11px] text-muted-foreground">
            Yukarıdaki liste bir ÖNGÖRÜDÜR: son kararı sunucu, tamamlama anındaki taze veriyle
            verir. Bu arada sevk edilen / taşınan / çuvala giren toplar işlenmez ve sebebiyle
            tutanağa yazılır.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={Boolean(blocked) || completeM.isPending}
            onClick={() => completeM.mutate()}
          >
            {completeM.isPending ? "Tamamlanıyor…" : completeButtonLabel(scope)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
