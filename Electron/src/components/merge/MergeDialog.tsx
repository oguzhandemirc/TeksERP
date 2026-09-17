import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchesConfirmation } from "@/components/forms/TypeToConfirm";
import { MergeConfirmGate } from "@/pages/System/Duplicates/MergeConfirmGate";
import {
  MERGE_ENTITY_LABEL,
  mergeService,
  type MergeEntity,
} from "@/services/mergeService";

/**
 * BİRLEŞTİRME DİYALOĞU — TEK KAYNAK (2026-08-22).
 *
 * İki yerden açılır: Sistem → Mükerrer Kayıtlar paneli ve Tanımlar listeleri
 * (Müşteriler, Ürünler…) — kullanıcı kararı: *"cari listesinde çalışırken iki
 * satırı işaretleyip oradan birleştireyim, ayrı ekrana gitmeyeyim"*.
 *
 * ⚠️ İKİNCİ BİR KOPYA YAZILMAZ. Onay kapısı (yazarak onay + gerekçe + çakışma
 * görüldü) tek yerde durmalı; iki kopya kaçınılmaz olarak ayrışır ve biri
 * eksik korumayla kalır. Panelde ekstra düğme gerekiyorsa `extraActions`
 * yuvasından geçirilir — bileşen çatallanmaz.
 *
 * ⚠️ AD/KOD PREVIEW'DEN OKUNUR, çağırandan DEĞİL. Çağıran yalnız id verir:
 * CrudPage'in generic satır tipi `{ id }` dışında bir şey garanti etmez ve
 * "adı da geçir" demek her listeyi ayrı ayrı doğru yazmaya bağlardı.
 */
export function MergeDialog({
  open,
  onOpenChange,
  entity,
  ids,
  preferredSurvivorId,
  extraActions,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entity: MergeEntity;
  /** Birleştirilecek kayıtların id'leri (en az 2). */
  ids: string[];
  /** KALACAK varsayılanı; verilmezse ilk id. */
  preferredSurvivorId?: string | null;
  /** Panele özel düğmeler ("Mükerrer değil" / "Ertele") — kapı çatallanmasın. */
  extraActions?: ReactNode;
  onMerged?: () => void;
}) {
  const qc = useQueryClient();
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [seenConflicts, setSeenConflicts] = useState(false);
  const [fieldPicks, setFieldPicks] = useState<Record<string, string>>({});

  // Diyalog her açılışta SIFIRLANIR: önceki birleştirmenin yazılmış gerekçesi
  // ve onay metni bir sonrakine taşınırsa "yazarak onay" kapısı boşa düşer.
  useEffect(() => {
    if (!open) return;
    setSurvivorId(preferredSurvivorId ?? ids[0] ?? null);
    setTyped("");
    setReason("");
    setSeenConflicts(false);
    setFieldPicks({});
  }, [open, preferredSurvivorId, ids]);

  const sourceIds = useMemo(
    () => (survivorId ? ids.filter((id) => id !== survivorId) : []),
    [ids, survivorId],
  );

  const previewQuery = useQuery({
    queryKey: ["merge-preview", entity, survivorId, sourceIds],
    queryFn: () => mergeService.preview(entity, survivorId!, sourceIds),
    enabled: Boolean(open && survivorId && sourceIds.length > 0),
  });
  const preview = previewQuery.data?.data;

  const columns = useMemo(
    () =>
      preview
        ? [
            ...(preview.survivor ? [{ ...preview.survivor, isSurvivor: true }] : []),
            ...preview.sources.map((s) => ({ ...s, isSurvivor: false })),
          ]
        : [],
    [preview],
  );

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeService.merge(entity, {
        survivorId: survivorId!,
        sourceIds,
        reason: reason.trim(),
        acknowledgedConflicts: preview?.conflicts.length ?? 0,
        // Sunucu önerisiyle AYNI olan seçim gönderilmez; öneri kuralı iki tarafta da aynı.
        fieldPicks: Object.fromEntries(
          Object.entries(fieldPicks).filter(([field, recordId]) => {
            const choice = preview?.fieldChoices.find((f) => f.field === field);
            return choice ? choice.suggestedFromId !== recordId : false;
          }),
        ),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.mergedCount} kayıt birleştirildi.`);
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["duplicate-records"] });
      void qc.invalidateQueries({ queryKey: ["duplicate-candidates"] });
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
      onMerged?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const survivorCode = preview?.survivor?.code ?? preview?.survivor?.name ?? "";
  const canSubmit =
    Boolean(preview?.canMerge) &&
    reason.trim().length >= 10 &&
    matchesConfirmation(typed, survivorCode) &&
    (preview!.conflicts.length === 0 || seenConflicts) &&
    !mergeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{MERGE_ENTITY_LABEL[entity]} kayıtlarını birleştir</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-medium">
              Hangi kayıt KALSIN? (diğerleri buna birleşecek)
            </h4>
            {columns.length === 0 ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-1">
                {columns.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="survivor"
                      checked={survivorId === r.id}
                      onChange={() => {
                        setSurvivorId(r.id);
                        setTyped("");
                        setFieldPicks({});
                      }}
                    />
                    <code className="text-xs text-muted-foreground">{r.code ?? "—"}</code>
                    <span className="min-w-0 truncate">{r.name}</span>
                    {r.isSurvivor && (
                      <span className="ml-auto flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <Users className="h-3 w-3" />
                        kalacak
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {extraActions}

          {previewQuery.isLoading && <Skeleton className="h-40 w-full" />}
          {previewQuery.isError && (
            <Callout tone="danger" title="Önizleme alınamadı">
              {(previewQuery.error as Error).message}
            </Callout>
          )}
          {preview && (
            <MergeConfirmGate
              preview={preview}
              typed={typed}
              onTypedChange={setTyped}
              reason={reason}
              onReasonChange={setReason}
              seenConflicts={seenConflicts}
              onSeenConflictsChange={setSeenConflicts}
              fieldPicks={fieldPicks}
              onFieldPickChange={(field, recordId) =>
                setFieldPicks((p) => ({ ...p, [field]: recordId }))
              }
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => mergeMutation.mutate()}>
            {mergeMutation.isPending ? "Birleştiriliyor…" : "Birleştir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
