// =============================================================================
// SAYIM KÂĞIDI (detay) — okut · işaretle · tamamla
// =============================================================================
// Bu ekran bir ÇALIŞMA KÂĞIDIDIR: buradaki hiçbir işaret deftere yazmaz. Tek
// yıkıcı adım "Tamamla"dır ve kendi onay ekranı vardır.
//
// ⚠️ OKUTMA AKIŞI ASIL AKIŞTIR. Depoda tarayıcıyla dolaşan kişi 300 satırlık bir
// tabloyu gözle taramaz: kutu her zaman odakta kalır, okutulan kod satırı bulur,
// "bulundu" işaretler ve kutu temizlenir. Bu yüzden istek OPTİMİST uygulanır —
// her okutmada listeyi yeniden çekmek, tarayıcının hızının çok altında kalır ve
// operatör "işaretlendi mi?" diye ekrana bakmak zorunda kalırdı. Hata durumunda
// cache SUNUCU GERÇEĞİNE geri döndürülür (`onError` → invalidate).
//
// ⚠️ LİSTEDE OLMAYAN BARKOD SESSİZ GEÇMEZ. Sayım defteri KISALTIR, genişletmez:
// fazla/yabancı top otomatik eklenmez, uyarı basılır ve doğru yol söylenir
// (transfer / mal kabul). Sessiz oto-ekleme, gerçek hatayı (yanlış rafa konmuş
// mal) örterdi.
//
// ⚠️ TAMAMLANMIŞ / İPTAL EDİLMİŞ sayımda yazma yüzeyi HİÇ ÇİZİLMEZ (gri buton
// bile değil): kapalı bir kâğıtta işaret kutusu görmek "hâlâ düzeltebilirim"
// vaadidir ve her tıklama 409 ile döner.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Ban, CheckCheck, Printer, ScanBarcode, Search } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { getStockCount, markAllFound, markStockCountLine, type StockCountDetail } from "./service";
import { STOCK_COUNTS_PATH, stockCountPath } from "./stockCount-regime";
import { CompleteStockCountDialog } from "./CompleteStockCountDialog";
import { CancelStockCountDialog } from "./CancelStockCountDialog";
import { CountBadge, RollLinesTable, YarnLinesTable } from "./StockCountLines";
import {
  EMPTY_ROLL_VIEW,
  STATUS_BADGE,
  STATUS_LABEL,
  cancelBlockReason,
  countProgress,
  filterRollLines,
  scanMatch,
  type RollViewFilter,
} from "./stockCountRules";

export function StockCountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const openTarget = useOpenTarget();
  const { hasPermission } = useRoleAccess();

  const [scan, setScan] = useState("");
  const [view, setView] = useState<RollViewFilter>(EMPTY_ROLL_VIEW);
  const [docOpen, setDocOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const key = ["stock-count", id] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => getStockCount(id!),
    enabled: Boolean(id),
  });
  const count = q.data ?? null;

  // Sekme başlığı sayım numarasını taşır (ShipmentDetailPage emsali).
  useEffect(() => {
    if (!count?.countNo || !id) return;
    const path = stockCountPath(id);
    const tab = useTabsStore.getState().tabs.find((t) => t.path === path);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, `Sayım · ${count.countNo}`);
  }, [count?.countNo, id]);

  const isDraft = count?.status === "DRAFT";
  const canWrite = isDraft && hasPermission("warehouse:transfer");

  /**
   * Satır işareti — OPTİMİST.
   *
   * ⚠️ `onError` cache'i SUNUCU GERÇEĞİNE döndürür. Optimist yazıp hatayı
   * yutmak, ekranda "bulundu" görünen ama sunucuda işaretsiz kalan satırlar
   * üretirdi; o satırlar tamamlamada "sayılmadı" sayılır ve kullanıcı sayımı
   * eksik yaptığını HİÇ ÖĞRENMEZ. (Hata toast'ı apiClient interceptor'undan.)
   */
  const markM = useMutation({
    mutationFn: (v: { lineId: string; found?: boolean | null; countedQty?: string | null }) =>
      markStockCountLine(id!, v.lineId, {
        ...(v.found !== undefined ? { found: v.found } : {}),
        ...(v.countedQty !== undefined ? { countedQty: v.countedQty } : {}),
      }),
    onMutate: (v) => {
      qc.setQueryData<StockCountDetail>(key, (old) =>
        old
          ? {
              ...old,
              lines: old.lines.map((l) =>
                l.id !== v.lineId
                  ? l
                  : {
                      ...l,
                      ...(v.found !== undefined ? { found: v.found } : {}),
                      ...(v.countedQty !== undefined ? { countedQty: v.countedQty } : {}),
                    },
              ),
            }
          : old,
      );
    },
    onError: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const markAllM = useMutation({
    mutationFn: () => markAllFound(id!),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.updated} satır işaretlendi.`);
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  // ⚠️ `count?.lines ?? []` DOĞRUDAN useMemo bağımlılığı olarak KULLANILMAZ: boş
  // dizi her render'da yeni bir referanstır, yani üç memo da her render'da
  // yeniden koşar (300 satırlık kâğıtta okutma akışını yavaşlatan tam da budur).
  const lines = useMemo(() => count?.lines ?? [], [count]);
  const progress = useMemo(() => countProgress(lines), [lines]);
  const rollLines = useMemo(() => filterRollLines(lines, view), [lines, view]);
  const yarnLines = useMemo(() => lines.filter((l) => l.kind === "YARN"), [lines]);

  const submitScan = () => {
    const result = scanMatch(lines, scan);
    switch (result.kind) {
      case "empty":
        return;
      case "unknown":
        // Sayım defteri KISALTIR, genişletmez — fazla top burada eklenmez.
        toast.warning(
          `“${result.code}” bu sayım listesinde yok. Başka depoda, üretimde ya da sevk edilmiş olabilir; ` +
            "fazla çıkan mal sayımla değil depo transferi / mal kabul ile kaydedilir.",
        );
        break;
      case "already":
        setHighlight(result.line.id);
        toast.info("Bu top zaten bulundu olarak işaretliydi.");
        break;
      case "revived":
        setHighlight(result.line.id);
        markM.mutate({ lineId: result.line.id, found: true });
        toast.success("Eksik işareti kaldırıldı — top bulundu.");
        break;
      case "found":
        setHighlight(result.line.id);
        markM.mutate({ lineId: result.line.id, found: true });
        break;
    }
    setScan("");
    scanRef.current?.focus();
  };

  const cancelBlocked = count ? cancelBlockReason(count.status) : null;

  return (
    <PageShell>
      <PageHeader
        title={count ? `Sayım ${count.countNo}` : "Sayım"}
        titleExtra={
          count ? <Badge variant={STATUS_BADGE[count.status]}>{STATUS_LABEL[count.status]}</Badge> : null
        }
        description={
          count
            ? `${count.warehouse.name} · açılış ${format(new Date(count.createdAt), "dd MMM yyyy HH:mm", { locale: tr })}`
            : undefined
        }
        onBack={() => openTarget(STOCK_COUNTS_PATH)}
        parent={{ label: "Stok Sayımı", to: STOCK_COUNTS_PATH }}
        actions={
          count ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDocOpen(true)}>
                <Printer className="mr-1 h-4 w-4" />
                Tutanağı Görüntüle / Bas
              </Button>
              {isDraft && (
                <>
                  <PermissionGate permission="warehouse:transfer">
                    <Button
                      variant="outline"
                      disabled={markAllM.isPending || progress.rollUncounted === 0}
                      title={
                        progress.rollUncounted === 0
                          ? "İşaretsiz top satırı kalmadı"
                          : "Sayılmamış TÜM top satırlarını bulundu yapar (eksik işaretlerine dokunmaz)"
                      }
                      onClick={() => markAllM.mutate()}
                    >
                      <CheckCheck className="mr-1 h-4 w-4" />
                      Hepsi Bulundu ({progress.rollUncounted})
                    </Button>
                  </PermissionGate>
                  <PermissionGate permission="warehouse:transfer">
                    <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={Boolean(cancelBlocked)}>
                      <Ban className="mr-1 h-4 w-4" />
                      Sayımı İptal Et
                    </Button>
                  </PermissionGate>
                  {/* ⚠️ İki izin VE ile aranır — backend `complete` ucu da iki
                      middleware zinciri uyguluyor (`roll:manual-adjust` +
                      `yarn:write`). Ayrışırsa kullanıcı tuşu görür ve 403 alır. */}
                  <PermissionGate allOf={["roll:manual-adjust", "yarn:write"]}>
                    <Button variant="destructive" onClick={() => setCompleteOpen(true)}>
                      Tamamla
                    </Button>
                  </PermissionGate>
                </>
              )}
            </div>
          ) : null
        }
      />

      {q.isLoading ? (
        <PageBody className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </PageBody>
      ) : q.isError ? (
        <PageBody className="p-6">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Sayım okunamadı.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “sayım yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
              İşaretlemeye devam etmeden önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        </PageBody>
      ) : !count ? (
        <PageBody className="p-6">
          <p className="py-16 text-center text-sm text-muted-foreground">Sayım bulunamadı.</p>
        </PageBody>
      ) : (
        <>
          {/* OKUTMA ŞERİDİ — yalnız taslakta ve yazma yetkisiyle. */}
          {canWrite && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
              <div className="relative w-80">
                <ScanBarcode className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={scanRef}
                  autoFocus
                  className="pl-8"
                  placeholder="Barkod okut veya yaz, Enter…"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitScan();
                    }
                  }}
                />
              </div>
              <Button variant="outline" onClick={submitScan}>
                İşaretle
              </Button>
              <span className="text-xs text-muted-foreground">
                Okutulan top “bulundu” olur. Listede olmayan barkod EKLENMEZ — uyarı basılır.
              </span>
            </div>
          )}

          <PageBody className="space-y-4 p-6">
            {/* SAYAÇLAR — top ve iplik AYRI (kg metreye toplanmaz). */}
            <div className="flex flex-wrap items-center gap-2">
              <CountBadge label="Top" value={progress.rollTotal} />
              <CountBadge label="Bulundu" value={progress.rollFound} />
              <CountBadge label="Eksik" value={progress.rollMissing} />
              <CountBadge label="Sayılmadı" value={progress.rollUncounted} />
              {progress.yarnTotal > 0 && (
                <>
                  <span className="mx-1 text-muted-foreground">|</span>
                  <CountBadge label="İplik kalemi" value={progress.yarnTotal} />
                  <CountBadge label="Sayılan" value={progress.yarnCounted} />
                </>
              )}
            </div>

            {count.status === "CANCELLED" && (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Bu sayım iptal edildi{count.cancelReason ? ` — ${count.cancelReason}` : ""}. Stok ve
                bakiyeler ETKİLENMEDİ; işaretler yalnız kayıt olarak duruyor.
              </p>
            )}
            {count.status === "COMPLETED" && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                Sayım{" "}
                {count.completedAt
                  ? format(new Date(count.completedAt), "dd MMM yyyy HH:mm", { locale: tr })
                  : ""}{" "}
                tamamlandı; fark fişi yazıldı ve tutanak donduruldu. Yanlış düşülen top varsa
                Envanter’den iptali geri alın, iplik farkı için ters düzeltme girin.
              </p>
            )}
            {count.notes && <p className="text-sm">Not: {count.notes}</p>}

            {/* TOP SATIRLARI */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Toplar</h2>
                <div className="relative w-64">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8"
                    placeholder="Barkod / ürün ara…"
                    value={view.search}
                    onChange={(e) => setView({ ...view, search: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="sc-only-uncounted"
                    checked={view.onlyUncounted}
                    onCheckedChange={(c) => setView({ ...view, onlyUncounted: c === true })}
                  />
                  <Label htmlFor="sc-only-uncounted" className="cursor-pointer text-sm font-normal">
                    Yalnız sayılmayanlar
                  </Label>
                </div>
                <span className="text-xs text-muted-foreground">
                  {rollLines.length} / {progress.rollTotal} satır
                </span>
              </div>

              {progress.rollTotal === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Bu depoda sayılabilir top yoktu (fotoğraf anında). İplik kalemleri aşağıda.
                </p>
              ) : rollLines.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  {/* Süzgeç açıkken "top yok" DEMEZ — liste daraltılmış durumda. */}
                  Bu süzgeçle top satırı yok. Aramayı temizleyin ya da “Yalnız sayılmayanlar”
                  kutusunu kaldırın.
                </p>
              ) : (
                <RollLinesTable
                  lines={rollLines}
                  status={count.status}
                  highlightLineId={highlight}
                  pendingLineId={markM.isPending ? (markM.variables?.lineId ?? null) : null}
                  onMark={
                    canWrite ? (lineId, found) => markM.mutate({ lineId, found }) : undefined
                  }
                />
              )}
            </section>

            {/* İPLİK SATIRLARI — yalnız varsa çizilir (boş başlıklı tablo
                "iplik kaybolmuş" diye okunur). */}
            {yarnLines.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">İplik (kg)</h2>
                <YarnLinesTable
                  lines={yarnLines}
                  status={count.status}
                  pendingLineId={markM.isPending ? (markM.variables?.lineId ?? null) : null}
                  onCount={
                    canWrite
                      ? (lineId, wire) => markM.mutate({ lineId, countedQty: wire })
                      : undefined
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Kutuyu boş bırakmak “saymadım” demektir ve bakiyeye dokunmaz. “0” yazmak ise
                  gerçek bir sayımdır: tamamlamada bakiye sıfırlanır.
                </p>
              </section>
            )}
          </PageBody>
        </>
      )}

      <PrintedDocDialog
        docType="STOCK_COUNT"
        sourceId={id ?? null}
        open={docOpen}
        onOpenChange={setDocOpen}
        title={`Stok Sayım Tutanağı — ${count?.countNo ?? ""}`}
        description="Tutanak TAMAMLAMADA donar; taslakta gördüğünüz çıktı canlı bir ÖNİZLEMEDİR."
        // Taslakta donmuş belge yoktur → canlı önizleme (backend `buildPreview`).
        allowDraft
        // Revizyon yetkisi backend DOC_PERMISSIONS.STOCK_COUNT.write ile hizalı.
        writePermission="roll:manual-adjust"
      />

      {completeOpen && count && (
        <CompleteStockCountDialog
          count={count}
          onOpenChange={setCompleteOpen}
          onCompleted={() => void q.refetch()}
        />
      )}
      {cancelOpen && count && (
        <CancelStockCountDialog
          count={count}
          onOpenChange={setCancelOpen}
          onCancelled={() => void q.refetch()}
        />
      )}
    </PageShell>
  );
}
