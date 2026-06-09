import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, RefreshCw, FileWarning } from "lucide-react";
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
}

export function DocVersionBar({
  docType,
  sourceId,
  current,
  activeVersion,
  onSelectVersion,
  canReissue,
}: Props) {
  const qc = useQueryClient();
  const [reissueOpen, setReissueOpen] = useState(false);
  const viewingOld = current.version !== activeVersion;
  const meta = STATUS_META[current.status];

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono font-semibold">{current.documentNo}</span>
        <Badge variant="outline">Rev.{current.version}</Badge>
        <Badge variant={meta.variant}>{meta.label}</Badge>
        {current.reconstructed && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
            <FileWarning className="h-3.5 w-3.5" /> geriye dönük oluşturuldu
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          donduruldu: {safeFormat(current.snapshot.frozenAt, "dd.MM.yyyy HH:mm")}
        </span>
        {current.status === "VOIDED" && current.voidReason && (
          <span className="text-[11px] text-destructive">— {current.voidReason}</span>
        )}
        {current.status === "ACTIVE" && current.reissueReason && (
          <span className="text-[11px] text-muted-foreground">
            revizyon: «{current.reissueReason}»
          </span>
        )}
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

        <VersionHistory
          docType={docType}
          sourceId={sourceId}
          currentVersion={current.version}
          onSelectVersion={onSelectVersion}
        />

        {canReissue && current.status !== "VOIDED" && !viewingOld && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => setReissueOpen(true)}
            title="Belge içeriğini güncel veriyle yeni versiyon olarak dondur"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Revize Et
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

function VersionHistory({
  docType,
  sourceId,
  currentVersion,
  onSelectVersion,
}: {
  docType: PrintedDocType;
  sourceId: string;
  currentVersion: number;
  onSelectVersion: (version: number | null) => void;
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
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1">
          <History className="h-3.5 w-3.5" /> Geçmiş
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Versiyon Geçmişi
        </div>
        {q.isLoading && <div className="p-2 text-[12px] text-muted-foreground">Yükleniyor…</div>}
        {!q.isLoading && versions.length === 0 && (
          <div className="p-2 text-[12px] text-muted-foreground">Kayıt yok.</div>
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
