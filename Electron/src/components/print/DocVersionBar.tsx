import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, RefreshCw, FileWarning, Paintbrush } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import {
  printedDocumentService,
  type PrintedDocType,
  type PrintedDocStatus,
  type PrintedDocument,
} from "@/services/printedDocumentService";

// =============================================================================
// Resmi belge versiyon şeridi — `.print-area` DIŞINDA durur (baskıya girmez).
// Versiyon/durum rozeti + gerekçeli "Revize Et" + versiyon geçmişi. Geçmişten
// eski versiyon seçilince `onSelectVersion` ile sheet o snapshot'ı gösterir.
// =============================================================================

const STATUS_META: Record<PrintedDocStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIVE: { label: "Güncel", variant: "default" },
  SUPERSEDED: { label: "Revize edildi", variant: "secondary" },
  VOIDED: { label: "İPTAL", variant: "destructive" },
};

interface Props {
  docType: PrintedDocType;
  sourceId: string;
  /** Şu an sheet'te gösterilen belge (current veya seçili versiyon). */
  current: PrintedDocument<unknown>;
  /** Sheet'in güncel ACTIVE versiyonu (revize sonrası buna döner). */
  activeVersion: number;
  /** Geçmişten versiyon seçimi (null = güncele dön). */
  onSelectVersion: (version: number | null) => void;
  /** Revizyon yetkisi (modülün yazma izni). */
  canReissue: boolean;
  /** true ise "Revize Et" YALNIZ geriye-dönük (reconstructed) belgelerde çıkar.
   *  Sevk irsaliyesi gibi kaynağı sevk anında donan ve sonradan düzenlenemeyen
   *  belgelerde normal revize aynı içeriği yeniden dondurur (boşa v2) → gizlenir;
   *  yalnız eski sistemden kalan geriye-dönük kayıtları resmîleştirmek için görünür.
   *  Kartela/fason gibi kaynağı değişebilen belgeler bu prop'u vermez → hep görünür. */
  reissueOnlyWhenReconstructed?: boolean;
  /** "Güncel görünüm" modu açık mı — verilirse toggle gösterilir. İçerik donuk kalır,
   *  yalnız görünüm (şablon+künye) güncel ayardan çözülür. */
  currentTemplate?: boolean;
  onCurrentTemplateChange?: (v: boolean) => void;
  /** Donmuş görünüm güncel şablondan FARKLI mı (backend getCurrent hesaplar). "Güncel
   *  görünüm" tuşu yalnız farklıysa çıkar (aynıysa toggle anlamsız); mod açıkken tuş
   *  "Orijinal görünüm" olarak hep durur (geri dönüş). */
  templateStale?: boolean;
}

export function DocVersionBar({
  docType,
  sourceId,
  current,
  activeVersion,
  onSelectVersion,
  canReissue,
  reissueOnlyWhenReconstructed = false,
  currentTemplate,
  onCurrentTemplateChange,
  templateStale = false,
}: Props) {
  const qc = useQueryClient();
  const [reissueOpen, setReissueOpen] = useState(false);
  const viewingOld = current.version !== activeVersion;
  const meta = STATUS_META[current.status];
  // Bazı belgelerde (sevk irsaliyesi) revize yalnız geriye-dönük kayıtta anlamlı;
  // güncel dondurulmuş kayıtta aynı içeriği tekrar dondurur → tuşu gizle.
  //
  // ⭐ İSTİSNA — ŞABLON DEĞİŞTİYSE REVİZE ANLAMLIDIR (2026-09-07 saha turu).
  // Kullanıcının sözü: *"güncel görünüme aldıktan sonra artık geçerli görünümün
  // o olması gerekir."* Haklı: "Güncel görünüm" bugüne kadar yalnız bir
  // ÖNİZLEMEYDİ — belgeyi güncel şablonla çizip gösteriyor ama hiçbir şeyi
  // kalıcı yapmıyordu. Kalıcı yapan tuş (`Revize Et`) ise tam da bu belge
  // türünde gizliydi.
  //
  // Gizleme gerekçesi "aynı içerik yeniden donar → boşa v2" idi ve İÇERİK
  // değişmediği sürece doğru. Ama `templateStale` demek çıktının GERÇEKTEN
  // farklı olması demek; orada revize boşa v2 değil, istenen şeyin ta kendisi.
  // Yani kural tam da gerektiği yerde tuşu gizliyordu.
  const showReissue =
    canReissue &&
    current.status !== "VOIDED" &&
    !viewingOld &&
    (!reissueOnlyWhenReconstructed || current.reconstructed || !!templateStale);

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border bg-background px-2 py-1.5">
      <div className="min-w-0">
        {/* Satır 1 — kimlik + durum (sade). */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-mono font-semibold">{current.documentNo}</span>
          <Badge variant="outline">Rev.{current.version}</Badge>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          {current.reconstructed && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
              <FileWarning className="h-3.5 w-3.5" /> geriye dönük
            </span>
          )}
        </div>
        {/* Satır 2 — donma zamanı + revizyon/iptal nedeni (soluk, ikincil). */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>donduruldu: {safeFormat(current.snapshot.frozenAt, "dd.MM.yyyy HH:mm")}</span>
          {current.status === "ACTIVE" && current.reissueReason && (
            <span>· revizyon: «{current.reissueReason}»</span>
          )}
          {current.status === "VOIDED" && current.voidReason && (
            <span className="text-destructive">· iptal: {current.voidReason}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {viewingOld && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7"
            onClick={() => onSelectVersion(null)}
          >
            Güncele dön (Rev.{activeVersion})
          </Button>
        )}

        {/* "Güncel görünüm" ↔ "Orijinal görünüm" — donmuş belgeyi güncel şablonla
            basma modu. Kapalıyken tuş YALNIZ şablon gerçekten değiştiyse (templateStale)
            çıkar; açıkken geri dönüş için hep durur. "Güncel" rozetiyle (sürüm durumu)
            karışmasın diye "şablon" yerine "görünüm". */}
        {onCurrentTemplateChange && (currentTemplate || templateStale) && (
          <Button
            type="button"
            size="sm"
            variant={currentTemplate ? "secondary" : "outline"}
            className={
              currentTemplate
                ? "h-7 gap-1"
                : "h-7 gap-1 border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
            }
            onClick={() => onCurrentTemplateChange(!currentTemplate)}
            title={
              currentTemplate
                ? "Belgenin donmuş (orijinal) görünümüne dön"
                : "Belge içeriği donuk kalır; görünüm (şablon/künye) güncel Belge Şablonları ayarıyla basılır"
            }
          >
            <Paintbrush className="h-3.5 w-3.5" />
            {currentTemplate ? "Orijinal görünüm" : "Güncel görünüm"}
          </Button>
        )}

        <DocVersionHistory
          docType={docType}
          sourceId={sourceId}
          currentVersion={current.version}
          onSelectVersion={onSelectVersion}
        />

        {showReissue && (
          <Button
            type="button"
            size="sm"
            variant={templateStale ? "default" : "outline"}
            className="h-7 gap-1"
            onClick={() => setReissueOpen(true)}
            title={
              templateStale
                ? "Bu görünümü KALICI yap — belge güncel şablonla yeni versiyon olarak donar"
                : "Belge içeriğini güncel veriyle yeni versiyon olarak dondur"
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {templateStale ? "Bu görünümü kalıcı yap" : "Revize Et"}
          </Button>
        )}
      </div>

      <ReissueDialog
        open={reissueOpen}
        onOpenChange={setReissueOpen}
        onConfirm={async (reason) => {
          await printedDocumentService.reissue(docType, sourceId, reason);
          // Belge query'sini tazele → sheet yeni ACTIVE versiyonu çeker.
          await qc.invalidateQueries({ queryKey: ["printed-doc", docType, sourceId] });
          await qc.invalidateQueries({ queryKey: ["printed-doc-versions", docType, sourceId] });
          onSelectVersion(null);
          toast.success("Belge revize edildi — yeni versiyon dondu");
        }}
      />
    </div>
  );
}

/**
 * Versiyon geçmişi açılır listesi — şeritten AYRI kullanılabilir (export).
 *
 * Refakat kartı (2026-08-17) tam şeridi kullanamaz: onun "Revize Et"i yoktur
 * (sürüm baskıda otomatik doğar) ve belgesi kendi HTML ucundan basılır. Yeni bir
 * geçmiş açılır listesi yazmak yerine bu bileşen paylaşılır — iki geçmiş listesi
 * zamanla ayrışırdı.
 */
export function DocVersionHistory({
  docType,
  sourceId,
  currentVersion,
  onSelectVersion,
  compact = true,
  emptyText = "Kayıt yok.",
}: {
  docType: PrintedDocType;
  sourceId: string;
  currentVersion: number;
  onSelectVersion: (version: number | null) => void;
  /** Şerit içinde h-7 (varsayılan). Normal boyutlu buton dizisine konacaksa false. */
  compact?: boolean;
  /** Boş defterin SEBEBİ belge tipine göre değişir — refakat kartında "henüz
   *  basılmadı", donarak doğan belgelerde gerçekten anormaldir. */
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["printed-doc-versions", docType, sourceId],
    queryFn: () => printedDocumentService.listVersions(docType, sourceId),
    enabled: open,
    staleTime: 30_000,
  });
  const versions = q.data?.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={compact ? "sm" : "default"}
          variant="outline"
          className={compact ? "h-7 gap-1" : "gap-1"}
        >
          <History className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> Geçmiş
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Versiyon Geçmişi
        </div>
        {q.isLoading && <div className="p-2 text-[12px] text-muted-foreground">Yükleniyor…</div>}
        {!q.isLoading && versions.length === 0 && (
          <div className="p-2 text-[12px] leading-relaxed text-muted-foreground">{emptyText}</div>
        )}
        <div className="max-h-72 space-y-1 overflow-auto">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onSelectVersion(v.version === currentVersion ? null : v.version);
                setOpen(false);
              }}
              className={`flex w-full flex-col gap-0.5 rounded border px-2 py-1.5 text-left text-[11px] hover:bg-muted ${
                v.version === currentVersion ? "border-primary bg-muted/40" : "border-transparent"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  Rev.{v.version}{" "}
                  <span className="font-normal text-muted-foreground">
                    {STATUS_META[v.status].label}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {safeFormat(v.createdAt, "dd.MM.yy HH:mm")}
                </span>
              </div>
              {v.reissueReason && <div className="text-muted-foreground">«{v.reissueReason}»</div>}
              {v.voidReason && <div className="text-destructive">İptal: {v.voidReason}</div>}
              {v.printedBy && <div className="text-muted-foreground">{v.printedBy.fullName}</div>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReissueDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: (r: string) => onConfirm(r),
    onSuccess: () => {
      setReason("");
      onOpenChange(false);
    },
  });
  const trimmed = reason.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Belgeyi Revize Et</DialogTitle>
          <DialogDescription>
            Mevcut belge "Revize edildi" olarak arşivlenir; güncel veriyle yeni bir versiyon
            dondurulur. Önceki versiyon silinmez, geçmişte kalır.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label htmlFor="reissue-reason" className="text-xs font-medium">
            Revizyon gerekçesi (zorunlu)
          </label>
          <textarea
            id="reissue-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Örn. plaka yanlış girilmişti; sürücü değişti…"
            className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={trimmed.length < 3 || mut.isPending}
            onClick={() => mut.mutate(trimmed)}
          >
            {mut.isPending ? "Revize ediliyor…" : "Revize Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
