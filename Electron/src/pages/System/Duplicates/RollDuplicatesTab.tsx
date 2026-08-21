import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  duplicateRollsService,
  type DuplicateRollCluster,
} from "@/services/mergeService";

const RANGES = [
  { days: 30, label: "Son 30 gün" },
  { days: 90, label: "Son 90 gün" },
  { days: 365, label: "Son 1 yıl" },
];

const LEVEL_LABEL: Record<DuplicateRollCluster["level"], string> = {
  STRONG: "güçlü şüphe",
  SUSPECT: "şüpheli",
  WEAK: "zayıf",
};

/**
 * HAYALET TOP (mükerrer ham giriş) sekmesi.
 *
 * Ana veri birleştirmesinden AYRI bir fiil: burada birleştirme YOKTUR, fazlalık
 * İPTAL edilir (`MUKERRER`). Sebep: top bir işlem kaydıdır — iki kaydı birleştirmek
 * metrajı toplamak olurdu, oysa fiziksel olarak tek top vardı.
 *
 * ⚠️ Liste bir KANIT DEĞİL ŞÜPHEDİR: KK1 seri girişi (aynı balyadan arka arkaya
 * eşit metrajlı toplar) veriye birebir aynı deseni yazar. Ekran bunu her kümede
 * söyler ve zayıf kümelerde iptal düğmesini vurgulamaz.
 *
 * ⚠️ İptal, topun KENDİ ucundan geçer (`DELETE /api/rolls/:id`) — toplu iptal ucu
 * yok ki o ucun etiket/çuval/sevkiyat guard'ları atlanmasın. Bir top düşerse
 * diğerleri devam eder ve sonuç dürüstçe raporlanır (kısmi başarı gizlenmez).
 */
export function RollDuplicatesTab() {
  const qc = useQueryClient();
  const [days, setDays] = useState(90);
  const [keepByCluster, setKeepByCluster] = useState<Record<string, string>>({});
  const [confirmFor, setConfirmFor] = useState<DuplicateRollCluster | null>(null);

  const scanQuery = useQuery({
    queryKey: ["duplicate-rolls", days],
    queryFn: () => duplicateRollsService.scan(days),
    refetchOnMount: "always",
  });
  const scan = scanQuery.data?.data;

  const keepIdOf = (c: DuplicateRollCluster): string => keepByCluster[c.key] ?? c.suggestedKeepId;
  const cancelListOf = (c: DuplicateRollCluster) =>
    c.rolls.filter((r) => r.id !== keepIdOf(c) && !r.blockedReason);

  const cancelMutation = useMutation({
    mutationFn: async (cluster: DuplicateRollCluster) => {
      const targets = cancelListOf(cluster);
      const failed: Array<{ barcode: string; message: string }> = [];
      let ok = 0;
      for (const r of targets) {
        try {
          await duplicateRollsService.cancel(r.id);
          ok++;
        } catch (e) {
          failed.push({ barcode: r.barcode ?? r.id.slice(0, 8), message: (e as Error).message });
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (failed.length === 0) {
        toast.success(`${ok} top iptal edildi (sebep: Mükerrer).`);
      } else {
        // Kısmi başarı GİZLENMEZ — hangi top neden düştü, operatör görsün.
        toast.warning(
          `${ok} top iptal edildi, ${failed.length} tanesi düştü: ` +
            failed.map((f) => `${f.barcode} (${f.message})`).join(" · "),
        );
      }
      setConfirmFor(null);
      void qc.invalidateQueries({ queryKey: ["duplicate-rolls"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clusters = scan?.clusters ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.days}
            size="sm"
            variant={r.days === days ? "default" : "outline"}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void scanQuery.refetch()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Yeniden tara
        </Button>
      </div>

      <Callout tone="warning" title="Bu liste bir kanıt değil, şüphe listesidir">
        Ham giriş ekranı seri giriş için tasarlıdır: aynı balyadan arka arkaya girilen eşit
        metrajlı toplar burada da mükerrer gibi görünür. Karar fiziksel sayım ve operatör
        teyidiyle verilir. Üretime girmiş (hareket görmüş) toplar listeye hiç alınmaz.
      </Callout>

      {scan && (
        <div className="text-xs text-muted-foreground">
          {scan.totals.scanned} giriş topu tarandı · {scan.totals.touched} tanesi hareket gördüğü
          için elendi · {scan.totals.clusters} şüpheli küme / {scan.totals.extras} fazladan kayıt ·
          pencere {scan.windowSec} sn
        </div>
      )}

      {scanQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : scanQuery.isError ? (
        <Callout tone="danger" title="Tarama yapılamadı">
          {(scanQuery.error as Error).message}
        </Callout>
      ) : clusters.length === 0 ? (
        <Callout tone="success" title="Şüpheli küme bulunamadı">
          Seçilen dönemde aynı ürün/metraj/operatörle saniyeler arayla girilmiş, hiç işlem
          görmemiş top yok.
        </Callout>
      ) : (
        <div className="space-y-3">
          {clusters.map((c) => {
            const keepId = keepIdOf(c);
            const toCancel = cancelListOf(c);
            return (
              <div key={c.key} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={c.level === "STRONG" ? "destructive" : "secondary"}>
                      {LEVEL_LABEL[c.level]} · {c.score}/6
                    </Badge>
                    <span className="text-sm">
                      {c.itemName ?? c.itemId}
                      {c.colorName ? ` / ${c.colorName}` : ""} · {c.initialQty} m
                      {c.width ? ` / ${c.width} cm` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.operatorName ?? "—"} · {c.reasons.join(" · ")}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={c.level === "STRONG" ? "destructive" : "outline"}
                    disabled={toCancel.length === 0}
                    onClick={() => setConfirmFor(c)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Diğerlerini iptal et ({toCancel.length})
                  </Button>
                </div>

                <ul className="space-y-1 text-sm">
                  {c.rolls.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`keep-${c.key}`}
                          checked={keepId === r.id}
                          disabled={Boolean(r.blockedReason)}
                          onChange={() =>
                            setKeepByCluster((prev) => ({ ...prev, [c.key]: r.id }))
                          }
                        />
                        <code className="text-xs">{r.barcode ?? "(barkodsuz)"}</code>
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString("tr-TR")} · {r.status}
                      </span>
                      {r.labelPrinted && (
                        <Badge variant="outline" className="text-xs">
                          etiket basılı
                        </Badge>
                      )}
                      {keepId === r.id && <Badge variant="secondary">asıl (kalacak)</Badge>}
                      {r.blockedReason && (
                        <span className="text-xs text-amber-600">{r.blockedReason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(confirmFor)} onOpenChange={(v) => !v && setConfirmFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Fazladan kayıtları iptal et</DialogTitle>
          </DialogHeader>
          {confirmFor && (
            <div className="space-y-3 text-sm">
              <Callout tone="danger" title="Kayıtlar iptal edilecek">
                <b>{cancelListOf(confirmFor).length}</b> top “Mükerrer” sebebiyle iptal edilecek;{" "}
                <code>{confirmFor.rolls.find((r) => r.id === keepIdOf(confirmFor))?.barcode ?? "asıl"}</code>{" "}
                kalacak. İptal geri alınabilir (top listesindeki “İptali geri al”), ama önce
                fiziksel sayımla doğrulayın.
              </Callout>
              {cancelListOf(confirmFor).some((r) => r.labelPrinted) && (
                <Callout tone="warning" title="Basılı etiket var">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      İptal edilecek topların bazılarının etiketi basılmış. Kayıt silinse de
                      sahadaki kâğıt kalır — o barkodlar toplanıp imha edilmeli.
                    </span>
                  </span>
                </Callout>
              )}
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded border p-2 text-xs">
                {cancelListOf(confirmFor).map((r) => (
                  <li key={r.id}>
                    <code>{r.barcode ?? r.id.slice(0, 8)}</code> ·{" "}
                    {new Date(r.createdAt).toLocaleString("tr-TR")}
                    {r.labelPrinted ? " · etiket basılı" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFor(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => confirmFor && cancelMutation.mutate(confirmFor)}
            >
              {cancelMutation.isPending ? "İptal ediliyor…" : "İptal et"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
