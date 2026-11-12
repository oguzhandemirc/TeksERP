import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Pencil, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { labelService } from "@/services/labelService";
import type { PrintJobAttachment } from "@/services/printJobService";
import type { LabelPreviewResult } from "@/services/rollLabelEditService";
import { printTracked } from "@/lib/print";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { LabelPreviewZoom } from "./LabelPreviewZoom";
import { RollLabelEditPanel } from "./RollLabelEditPanel";
import { DesktopOnlyAction } from "@/components/ui/DesktopOnlyAction";

interface Props {
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RollLabelDialog({ rollId, onOpenChange }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();

  // Payload — barkod/kalite (fire kapısı) için; düzenleme formu kendi ucundan gelir.
  const payloadQuery = useQuery({
    queryKey: ["label-roll", rollId],
    queryFn: () => labelService.getRollLabel(rollId!),
    enabled: open,
  });

  // ── FİRE KAPISI (2026-08-20) ────────────────────────────────────────────
  // Fire kalitede top OTOMATİK etiket almaz; masaüstünden elle basmak MÜMKÜN
  // ama onay ister — mobildeki `startPrint` kapısının birebir ikizi. İki
  // istemcinin AYNI kuralı söylemesi şart: ayrışırsa aynı iş iki yerde iki
  // türlü davranır ve kural "hangi ekrandan bastığına" bağlı hale gelir.
  //
  // ⚠️ ÖNİZLEME DE KAPI ARKASINDA: backend `buildRollRenderInput` boğazında
  // durduğu için onaysız önizleme 409 döner. Bu yüzden onay, önizleme
  // yüklenmeden ÖNCE sorulur — yoksa kullanıcı "Etiket alınamadı" hatası görür.
  const [scrapConfirmed, setScrapConfirmed] = useState(false);
  const flagsQ = useFeatureFlags();
  const scrapLabelEnabled = flagsQ.data?.data?.scrapGradeLabelEnabled ?? false;
  const gradesQ = useQuery({
    queryKey: ["quality-grades", "skip-label"],
    queryFn: () => qualityGradeService.listCursor({ limit: 100, filters: { isActive: "true" } }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const payloadForGate = payloadQuery.data?.data;
  // Kalite KODU ile katalog satırı eşlenir (Roll.qualityGrade snapshot'ı).
  // Katalog yüklenmediyse/eşleşmediyse kapı KAPALI DEĞİL (fail-open): sunucu
  // ikinci hat olarak zaten reddeder, burada gereksiz sürtünme üretme.
  const isScrapGrade =
    !scrapLabelEnabled &&
    Boolean(payloadForGate?.qualityGrade) &&
    (gradesQ.data?.data ?? []).some(
      (g) => g.code === payloadForGate?.qualityGrade && g.skipLabel === true,
    );
  const scrapGateOpen = !isScrapGrade || scrapConfirmed;

  // Bu PC'ye yapılandırılmış seri/COM Argox varsa diyalogsuz baskı; yoksa printTracked (sistem penceresi / sessiz basım).
  const { directEnabled, printRoll, peripheralId } = useLabelPrinter();

  // WYSIWYG önizleme — AKTİF DİLDE (native PPLB → görsel SVG, baskıyla birebir).
  // Baskı yolu (native printRoll / printTracked) ayrı; önizleme artık gerçek çıktı.
  // peripheralId: önizleme bu PC'ye seçili yazıcının dilinde çözülür (baskıyla aynı).
  const previewQuery = useQuery({
    queryKey: ["label-roll-preview", rollId, peripheralId, scrapGateOpen],
    queryFn: () =>
      labelService.getRollPreview(
        rollId!,
        scrapConfirmed ? { confirmScrap: true } : undefined,
        peripheralId,
      ),
    // Kapı kapalıyken İSTEK ATILMAZ — 409'u görüp "hata" diye göstermek yerine
    // onay panelini çiziyoruz (kullanıcıya sebebi ve çıkış yolunu söyler).
    enabled: open && scrapGateOpen,
    staleTime: 0,
  });
  const preview = previewQuery.data;

  const [editOpen, setEditOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const printMut = useMutation({
    mutationFn: (printJob?: PrintJobAttachment) => labelService.printRollLabel(rollId!, undefined, printJob),
    onSuccess: () => {
      toast.success("Etiket basıldı (audit kaydı oluşturuldu).");
      // Baskı labelDirty'yi temizledi → liste + detay sheet "Etiket güncel değil" rozeti tazelensin.
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
    },
  });

  // `fresh`: "Kaydet ve bas" sonrası kayıtlı hâlin önizlemesi (sistem penceresi yolu bunu basar).
  const handlePrint = async (fresh?: LabelPreviewResult) => {
    if (directEnabled) {
      if (sending) return; // çift-tık koruması — seri/BT gönderim ~1sn sürebilir.
      setSending(true);
      try {
        // Diyalogsuz: native PPLA → seri/COM. Hata olursa diyaloğa DÜŞME (görünür hata).
        const r = await printRoll(rollId!, scrapConfirmed ? { confirmScrap: true } : undefined);
        if (r.ok) {
          printMut.mutate(r.printJob); // audit + "Etiket basıldı" toast'ı printMut.onSuccess'ten.
        } else {
          toast.error(r.error ?? "Yazıcıya gönderilemedi");
        }
      } finally {
        setSending(false);
      }
      return;
    }
    // Sistem penceresi yedeği: önizleme HTML'i boğazdan basılır. Ham komut önizlemesi (text)
    // OS penceresinden basılamaz — kâğıt çıkmadan "basıldı" damgası atılmaz.
    const doc = fresh ?? preview;
    if (!doc || doc.mode === "text") {
      toast.error("Bu etiket dili yazdırma penceresinden basılamaz; etiket yazıcısını ayarlayın.");
      return;
    }
    const out = await printTracked({
      subject: { kind: "ETIKET_TOP", table: "rolls", id: rollId! },
      html: doc.content,
      workEndpoint: true,
    });
    if (out.proceed) printMut.mutate(out.printJob);
  };

  const payload = payloadQuery.data?.data;
  // Kaydetme ucu `label:edit` ya da `roll:write` ister (backend requireAnyPermission ile aynı liste).
  const canEdit = hasPermission("label:edit") || hasPermission("roll:write");
  const canPrint = hasPermission("label:print");
  const hasBarcode = Boolean(payload?.barcode);

  const handleSaved = async (print: boolean) => {
    setEditOpen(false);
    if (!print) return;
    // Kayıtlı hâlin önizlemesi taze çekilir: sistem penceresi yolu tam bunu basar.
    const fresh = await qc.fetchQuery({
      queryKey: ["label-roll-preview", rollId, peripheralId, scrapGateOpen],
      queryFn: () => labelService.getRollPreview(rollId!, scrapConfirmed ? { confirmScrap: true } : undefined, peripheralId),
      staleTime: 0,
    });
    await handlePrint(fresh);
  };

  const close = (o: boolean) => {
    if (!o) setEditOpen(false);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={editOpen ? "max-w-6xl" : "max-w-3xl"}>
        <DialogHeader>
          <DialogTitle>{editOpen ? "Etiketi Düzenle" : "Top Etiketi"}</DialogTitle>
          <DialogDescription>
            {editOpen
              ? "Değişiklikler yalnız bu topun etiketinde görünür; kayıtlar (ölçü, cari, katalog) değişmez."
              : "Bas tuşuna basınca bu etiket olduğu gibi yazıcıya gider."}
          </DialogDescription>
        </DialogHeader>

        <PermissionGate
          permission="label:read"
          fallback={
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Bu top için etiket görüntüleme yetkisi yok.
            </div>
          }
        >
          {!scrapGateOpen ? (
            /* FİRE ONAY PANELİ — önizleme yerine. Engelleme DEĞİL, onaylatma:
               fire topun fiziksel tanımlanması gerekebilir ve baskı yolunu
               tamamen kapatmak sahayı çıkışsız bırakır. */
            <div className="flex h-[560px] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-amber-500/60 bg-amber-50/50 p-8 text-center dark:bg-amber-950/20">
              <AlertTriangle className="h-10 w-10 text-amber-600" />
              <div className="space-y-2">
                <p className="text-base font-semibold">Bu top fire kalitede</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Fire mala otomatik etiket basılmaz — etiket bir <em>satılabilirlik</em> işaretidir ve fire
                  malın akışa geri girmesini kolaylaştırır. Yine de gerekiyorsa etiketi görüp basabilirsiniz.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 border-amber-600 text-amber-700 hover:bg-amber-100 dark:text-amber-400"
                onClick={() => setScrapConfirmed(true)}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Yine de göster ve bas
              </Button>
            </div>
          ) : editOpen && rollId ? (
            <RollLabelEditPanel
              rollId={rollId}
              peripheralId={peripheralId}
              confirmScrap={scrapConfirmed}
              canSave={canEdit}
              canPrint={canPrint && hasBarcode}
              onCancel={() => setEditOpen(false)}
              onSaved={(print) => void handleSaved(print)}
            />
          ) : previewQuery.isLoading ? (
            <Skeleton className="h-[560px] w-full" />
          ) : previewQuery.isError ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
              Etiket alınamadı: {(previewQuery.error as Error).message}
            </div>
          ) : preview?.mode === "text" ? (
            /* Ham komut dili (görsel yok) — yazıcı dili ipucu yalnız burada. */
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Yazıcı dili {preview.language}: görsel önizleme yok, ham komut gösteriliyor.</p>
              <pre className="h-[560px] w-full overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
                {preview.content}
              </pre>
            </div>
          ) : (
            <LabelPreviewZoom content={preview?.content ?? ""} title="Top etiketi" />
          )}

          {!editOpen && (
            <DialogFooter className="flex flex-row flex-wrap items-center gap-2 sm:justify-between">
              <Button type="button" size="sm" variant="outline" onClick={() => close(false)}>
                Kapat
              </Button>
              <div className="flex gap-2">
                {canEdit && scrapGateOpen && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1" disabled={!payload}>
                    <Pencil className="h-3.5 w-3.5" /> Etiketi düzenle
                  </Button>
                )}
                {canPrint && payload && (
                  <DesktopOnlyAction>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasBarcode || !scrapGateOpen || previewQuery.isLoading || printMut.isPending || sending}
                      onClick={() => void handlePrint()}
                      className="gap-1"
                    >
                      <Printer className="h-3.5 w-3.5" /> Bas
                    </Button>
                  </DesktopOnlyAction>
                )}
              </div>
            </DialogFooter>
          )}
        </PermissionGate>
      </DialogContent>
    </Dialog>
  );
}
