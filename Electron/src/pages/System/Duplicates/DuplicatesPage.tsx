import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Merge, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
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
import { MergeConfirmGate } from "./MergeConfirmGate";
import {
  MERGE_ENTITIES,
  MERGE_ENTITY_LABEL,
  mergeService,
  type DuplicateGroup,
  type MergeEntity,
} from "@/services/mergeService";

/**
 * MÜKERRER KAYIT TEMİZLİĞİ.
 *
 * Yerleşim gerekçesi: araç DÖRT tanım ekranını birden keser (müşteri, kumaş,
 * renk, fason). Birinin içine koymak diğer üçünden gizlerdi — Veri Aktarımı
 * (`data:import`) ile birebir aynı şekil ve aynı sebep.
 *
 * ⚠️ Liste `mergedIntoId IS NULL` süzgeciyle gelir; birleştirilen çift bir daha
 * görünmez. Bu olmadan liste HİÇ boşalmazdı: operatör birleştirir, ekranı
 * yeniler ve aynı çifti tekrar görürdü.
 */
export function DuplicatesPage() {
  const qc = useQueryClient();
  // Derin bağlantı: tanım listelerindeki "Mükerrerler" düğmesi buraya
  // `?entity=item` ile gelir. Geçersiz değer sessizce yok sayılır — yazım
  // hatası yüzünden ekranı 400'e düşürmek operatörü çıkışsız bırakırdı.
  const [searchParams] = useSearchParams();
  const initialEntity = MERGE_ENTITIES.includes(
    (searchParams.get("entity") ?? "") as MergeEntity,
  )
    ? (searchParams.get("entity") as MergeEntity)
    : "customer";
  const [entity, setEntity] = useState<MergeEntity>(initialEntity);
  const [open, setOpen] = useState<DuplicateGroup | null>(null);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [seenConflicts, setSeenConflicts] = useState(false);

  const dupQuery = useQuery({
    queryKey: ["duplicates", entity],
    queryFn: () => mergeService.duplicates(entity),
    refetchOnMount: "always",
  });

  const sourceIds =
    open && survivorId ? open.records.filter((r) => r.id !== survivorId).map((r) => r.id) : [];

  const previewQuery = useQuery({
    queryKey: ["merge-preview", entity, survivorId, sourceIds],
    queryFn: () => mergeService.preview(entity, survivorId!, sourceIds),
    enabled: Boolean(open && survivorId && sourceIds.length > 0),
  });
  const preview = previewQuery.data?.data;

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeService.merge(entity, {
        survivorId: survivorId!,
        sourceIds,
        reason: reason.trim(),
        // Önizlemede GÖRÜLEN çakışma sayısı. Uyuşmazsa backend 409 verir —
        // "operatör gerçekten gördü" garantisinin taşıyıcısı bu sayı.
        acknowledgedConflicts: preview?.conflicts.length ?? 0,
      }),
    onSuccess: (res) => {
      toast.success(`${res.data.mergedCount} kayıt birleştirildi.`);
      closeDialog();
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function closeDialog(): void {
    setOpen(null);
    setSurvivorId(null);
    setTyped("");
    setReason("");
    setSeenConflicts(false);
  }

  const groups = dupQuery.data?.data ?? [];
  const survivorCode =
    preview?.survivor?.code ?? preview?.survivor?.name ?? "";
  const canSubmit =
    Boolean(preview?.canMerge) &&
    reason.trim().length >= 10 &&
    matchesConfirmation(typed, survivorCode) &&
    (preview!.conflicts.length === 0 || seenConflicts) &&
    !mergeMutation.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Mükerrer Kayıtlar"
        description="Aynı kaydın iki kez açılmış hâllerini tek kayda birleştirin"
        actions={
          <Button variant="outline" size="sm" onClick={() => void dupQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Yenile
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {MERGE_ENTITIES.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={e === entity ? "default" : "outline"}
            onClick={() => setEntity(e)}
          >
            {MERGE_ENTITY_LABEL[e]}
          </Button>
        ))}
      </div>

      {dupQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : groups.length === 0 ? (
        <Callout tone="success" title="Mükerrer kayıt bulunamadı">
          {MERGE_ENTITY_LABEL[entity]} listesinde aynı ada sahip birden fazla kayıt yok.
        </Callout>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {g.records.length} kayıt aynı ada sahip
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(g);
                    // En çok referansı olan kaydı ÖNER — ama seçim operatörün.
                    // Bu bir işletme kararıdır: "belgelerde hangi kod yazıyor?"
                    const best = [...g.records].sort(
                      (a, b) => (b.refCount ?? 0) - (a.refCount ?? 0),
                    )[0];
                    setSurvivorId(best?.id ?? null);
                  }}
                >
                  <Merge className="mr-2 h-4 w-4" />
                  Birleştir
                </Button>
              </div>
              <ul className="space-y-1 text-sm">
                {g.records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-4">
                    <span>
                      <code className="text-xs text-muted-foreground">{r.code ?? "—"}</code>{" "}
                      {r.name}
                      {!r.isActive && (
                        <span className="ml-2 text-xs text-muted-foreground">(pasif)</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {r.refCount === null ? "?" : r.refCount}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{MERGE_ENTITY_LABEL[entity]} kayıtlarını birleştir</DialogTitle>
          </DialogHeader>

          {open && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-medium">
                  Hangi kayıt KALSIN? (diğerleri buna birleşecek)
                </h4>
                <div className="space-y-1">
                  {open.records.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="survivor"
                        checked={survivorId === r.id}
                        onChange={() => {
                          setSurvivorId(r.id);
                          setTyped("");
                        }}
                      />
                      <code className="text-xs text-muted-foreground">{r.code ?? "—"}</code>
                      <span>{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({r.refCount === null ? "?" : r.refCount} referans)
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {previewQuery.isLoading && <Skeleton className="h-32 w-full" />}
              {preview && (
                <MergeConfirmGate
                  preview={preview}
                  typed={typed}
                  onTypedChange={setTyped}
                  reason={reason}
                  onReasonChange={setReason}
                  seenConflicts={seenConflicts}
                  onSeenConflictsChange={setSeenConflicts}
                />
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={!canSubmit}
              onClick={() => mergeMutation.mutate()}
            >
              {mergeMutation.isPending ? "Birleştiriliyor…" : "Birleştir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
