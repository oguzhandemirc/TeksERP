import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Pencil, X, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { labelService } from "@/services/labelService";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { relabelService } from "@/pages/Operations/RelabelStation/service";
import { RelabelPrintForCustomer as PrintForCustomerCard } from "./PrintForCustomerCard";

interface Props {
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RollLabelDialog({ rollId, onOpenChange }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Payload — orderLineId (Edit gating) ve LabelEditDialog için master adlar.
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

  // Bu PC'ye yapılandırılmış seri/COM Argox varsa diyalogsuz baskı; yoksa iframe.print().
  const { directEnabled, printRoll, peripheralId } = useLabelPrinter();

  // WYSIWYG önizleme — AKTİF DİLDE (native PPLB → görsel SVG, baskıyla birebir).
  // Baskı yolu (native printRoll / iframe.print) ayrı; önizleme artık gerçek çıktı.
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

  // Müşteri adayları + son baskı bilgisi için relabel bağlamı (aynı payload, rollId ile).
  const relabelCtxQuery = useQuery({
    queryKey: ["relabel-context", "roll", rollId],
    queryFn: () => relabelService.getContextByRollId(rollId!),
    enabled: open,
    staleTime: 0,
  });
  const relabelCtx = relabelCtxQuery.data?.data ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const printMut = useMutation({
    mutationFn: () => labelService.printRollLabel(rollId!),
    onSuccess: () => {
      toast.success("Etiket basıldı (audit kaydı oluşturuldu).");
      // Baskı labelDirty'yi temizledi → liste + detay sheet "Etiket güncel değil" rozeti tazelensin.
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
    },
  });

  const handlePrint = async () => {
    if (directEnabled) {
      if (sending) return; // çift-tık koruması — seri/BT gönderim ~1sn sürebilir.
      setSending(true);
      try {
        // Diyalogsuz: native PPLA → seri/COM. Hata olursa diyaloğa DÜŞME (görünür hata).
        const r = await printRoll(rollId!, scrapConfirmed ? { confirmScrap: true } : undefined);
        if (r.ok) {
          printMut.mutate(); // audit + "Etiket basıldı" toast'ı printMut.onSuccess'ten.
        } else {
          toast.error(r.error ?? "Yazıcıya gönderilemedi");
        }
      } finally {
        setSending(false);
      }
      return;
    }
    iframeRef.current?.contentWindow?.print();
    printMut.mutate();
  };

  const payload = payloadQuery.data?.data;
  const canEdit = Boolean(payload?.orderLineId) && hasPermission("label:edit");
  const canPrint = hasPermission("label:print");
  const hasBarcode = Boolean(payload?.barcode);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Top Etiketi</DialogTitle>
            <DialogDescription>
              Bas tuşuna basınca bu etiket olduğu gibi yazıcıya gider.
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
            {preview && (
              <div className="text-[11px] text-muted-foreground">
                Aktif dil: <strong>{preview.language}</strong> ·{" "}
                {preview.mode === "text" ? "ham komut (görsel yok)" : "önizleme = baskı"}
              </div>
            )}
            {previewQuery.isLoading ? (
              <Skeleton className="h-[640px] w-full" />
            ) : !scrapGateOpen ? (
              /* FİRE ONAY PANELİ — önizleme yerine. Engelleme DEĞİL, onaylatma:
                 fire topun fiziksel tanımlanması gerekebilir ve baskı yolunu
                 tamamen kapatmak sahayı çıkışsız bırakır. */
              <div className="flex h-[640px] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-amber-500/60 bg-amber-50/50 p-8 text-center dark:bg-amber-950/20">
                <AlertTriangle className="h-10 w-10 text-amber-600" />
                <div className="space-y-2">
                  <p className="text-base font-semibold">Bu top fire kalitede</p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Fire mala otomatik etiket basılmaz — etiket bir{" "}
                    <em>satılabilirlik</em> işaretidir ve fire malın akışa geri
                    girmesini kolaylaştırır. Yine de gerekiyorsa etiketi görüp
                    basabilirsiniz.
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
            ) : previewQuery.isError ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
                Etiket alınamadı: {(previewQuery.error as Error).message}
              </div>
            ) : preview?.mode === "text" ? (
              <pre className="h-[640px] w-full overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
                {preview.content}
              </pre>
            ) : (
              <iframe
                ref={iframeRef}
                title="Top etiketi"
                srcDoc={preview?.content ?? ""}
                sandbox="allow-same-origin allow-modals"
                className="h-[640px] w-full rounded border bg-white"
              />
            )}

            {/* "B müşterisi için bas" — etiket A'ya basılmış ama mal B'ye gidecek.
                2026-07-30: eskiden "Yeniden Etiketle/Düzenle" diyaloğundaydı; TÜM
                baskı işleri tek yerde toplansın diye buraya taşındı (veri düzeltme
                artık "Düzelt" diyaloğunda, baskı burada). */}
            {relabelCtx && <PrintForCustomerCard ctx={relabelCtx} />}

            <DialogFooter className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex gap-2">
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                    className="gap-1"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </Button>
                )}
                {canPrint && payload && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!hasBarcode || !scrapGateOpen || previewQuery.isLoading || printMut.isPending || sending}
                    onClick={handlePrint}
                    className="gap-1"
                  >
                    <Printer className="h-3.5 w-3.5" /> Bas
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  Kapat
                </Button>
              </div>
            </DialogFooter>
          </PermissionGate>
        </DialogContent>
      </Dialog>

      {payload?.orderLineId && (
        <LabelEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          orderLineId={payload.orderLineId}
          initialItemName={
            payload.itemNameSource === "OVERRIDE" ? payload.itemName : ""
          }
          initialColorName={
            payload.colorNameSource === "OVERRIDE" ? payload.colorName ?? "" : ""
          }
          masterItemName={payload.itemName}
          masterColorName={payload.colorName}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["label-roll", rollId] });
            void qc.invalidateQueries({ queryKey: ["label-roll-preview", rollId] });
          }}
        />
      )}
    </>
  );
}

function LabelEditDialog({
  open,
  onOpenChange,
  orderLineId,
  initialItemName,
  initialColorName,
  masterItemName,
  masterColorName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderLineId: string;
  initialItemName: string;
  initialColorName: string;
  masterItemName: string;
  masterColorName: string | null;
  onSaved: () => void;
}) {
  const [itemName, setItemName] = useState(initialItemName);
  const [colorName, setColorName] = useState(initialColorName);

  const mut = useMutation({
    mutationFn: () =>
      labelService.updateOrderLineOverride(orderLineId, {
        customerItemName: itemName.trim() === "" ? null : itemName.trim(),
        customerColorName: colorName.trim() === "" ? null : colorName.trim(),
      }),
    onSuccess: () => {
      toast.success("Etiket adı güncellendi.");
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Etiket Adlarını Düzenle</DialogTitle>
          <DialogDescription>
            Bu siparişe özel ad sabitlenir. Boş bırakırsanız master alias veya standart ad'a düşer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Müşterideki kumaş adı</label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder={masterItemName}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Boş bırakırsan etiketteki ad "{masterItemName}" olur.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium">Müşterideki renk adı</label>
            <Input
              value={colorName}
              onChange={(e) => setColorName(e.target.value)}
              placeholder={masterColorName ?? "(renk yok)"}
              disabled={!masterColorName}
            />
            {masterColorName && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Boş bırakırsan etiketteki ad "{masterColorName}" olur.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" /> İptal
          </Button>
          <Button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
