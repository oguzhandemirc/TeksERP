import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Merge, RefreshCw, Users, Clock, XCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchesConfirmation } from "@/components/forms/TypeToConfirm";
import { downloadBlob } from "@/lib/file-save";
import { MergeConfirmGate } from "./MergeConfirmGate";
import {
  DUPLICATE_RULE_LABEL,
  MERGE_ENTITIES,
  MERGE_ENTITY_LABEL,
  mergeService,
  type DuplicateCandidateGroup,
  type DuplicateCandidatePair,
  type DuplicateCandidateRecord,
  type MergeEntity,
} from "@/services/mergeService";

/**
 * MÜKERRER KAYITLAR — tespit kuyruğu + birleştirme (v2, 2026-08-22).
 *
 * Liste artık TESPİT MOTORUNDAN gelir (kesin ad · kimlik çakışması · benzer ad);
 * her aday GEREKÇELİ (rozet + ayrıntı satırı). Operatör üç şey yapabilir:
 *   • Birleştir — mevcut onay kapısı (survivor seç → önizleme → yazarak onay)
 *   • Mükerrer değil — çift kalıcı olarak kuyruktan düşer (filtreyle geri görülür)
 *   • Ertele — kuyrukta kalır, işaretli
 * Yerleşim gerekçesi değişmedi: araç dört tanım ekranını birden keser; Veri
 * Aktarımı ile aynı şekil.
 *
 * ⚠️ Bulanık eşik ve bayrak Ayarlar → Müşteriler → "Mükerrer kayıtlar" altında;
 * ekran mevcut değeri başlıkta söyler ki "niye bu çift çıktı/çıkmadı" sorusu
 * cevapsız kalmasın.
 */
export function DuplicatesPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialEntity = MERGE_ENTITIES.includes(
    (searchParams.get("entity") ?? "") as MergeEntity,
  )
    ? (searchParams.get("entity") as MergeEntity)
    : "customer";
  const [entity, setEntity] = useState<MergeEntity>(initialEntity);
  const [showNotDuplicate, setShowNotDuplicate] = useState(false);

  // Birleştirme diyaloğu (mevcut akış)
  const [open, setOpen] = useState<DuplicateCandidateGroup | null>(null);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [seenConflicts, setSeenConflicts] = useState(false);
  // Alan seçimi (P2): yalnız operatörün DEĞİŞTİRDİĞİ alanlar tutulur; gönderilmeyen
  // alanda sunucunun önerisi geçerli olur (ikisi de aynı kuralı uygular).
  const [fieldPicks, setFieldPicks] = useState<Record<string, string>>({});

  // Karar diyaloğu
  const [decideFor, setDecideFor] = useState<{
    pair: DuplicateCandidatePair;
    group: DuplicateCandidateGroup;
    decision: "NOT_DUPLICATE" | "DEFERRED";
  } | null>(null);
  const [note, setNote] = useState("");

  const scanQuery = useQuery({
    queryKey: ["duplicate-candidates", entity, showNotDuplicate],
    queryFn: () => mergeService.candidates(entity, showNotDuplicate),
    refetchOnMount: "always",
  });
  const scan = scanQuery.data?.data;

  const sourceIds =
    open && survivorId ? open.records.filter((r) => r.id !== survivorId).map((r) => r.id) : [];

  const previewQuery = useQuery({
    queryKey: ["merge-preview", entity, survivorId, sourceIds],
    queryFn: () => mergeService.preview(entity, survivorId!, sourceIds),
    enabled: Boolean(open && survivorId && sourceIds.length > 0),
  });
  const preview = previewQuery.data?.data;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["duplicate-candidates"] });
    void qc.invalidateQueries({ queryKey: ["duplicates"] });
  };

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeService.merge(entity, {
        survivorId: survivorId!,
        sourceIds,
        reason: reason.trim(),
        acknowledgedConflicts: preview?.conflicts.length ?? 0,
        // Sunucu önerisiyle AYNI olan seçimleri göndermeye gerek yok; farklı olanları
        // açıkça yaz (öneri kuralı iki tarafta da aynı).
        fieldPicks: Object.fromEntries(
          Object.entries(fieldPicks).filter(([field, recordId]) => {
            const choice = preview?.fieldChoices.find((f) => f.field === field);
            return choice ? choice.suggestedFromId !== recordId : false;
          }),
        ),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.mergedCount} kayıt birleştirildi.`);
      closeMerge();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideMutation = useMutation({
    mutationFn: () =>
      mergeService.decide({
        entity,
        aId: decideFor!.pair.aId,
        bId: decideFor!.pair.bId,
        decision: decideFor!.decision,
        note: note.trim() || null,
        evidence: decideFor!.pair.evidence,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Karar kaydedildi.");
      setDecideFor(null);
      setNote("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => mergeService.reopen(id),
    onSuccess: () => {
      toast.success("Karar geri açıldı — çift yeniden kuyrukta.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const csvMutation = useMutation({
    mutationFn: () => mergeService.candidatesCsv(entity, showNotDuplicate),
    onSuccess: (blob) => {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `mukerrer-adaylar-${entity}-${stamp}.csv`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function closeMerge(): void {
    setOpen(null);
    setSurvivorId(null);
    setTyped("");
    setReason("");
    setSeenConflicts(false);
    setFieldPicks({});
  }

  const groups = useMemo(() => scan?.groups ?? [], [scan]);
  const survivorCode = preview?.survivor?.code ?? preview?.survivor?.name ?? "";
  const canSubmit =
    Boolean(preview?.canMerge) &&
    reason.trim().length >= 10 &&
    matchesConfirmation(typed, survivorCode) &&
    (preview!.conflicts.length === 0 || seenConflicts) &&
    !mergeMutation.isPending;

  const recordById = useMemo(() => {
    const m = new Map<string, DuplicateCandidateRecord>();
    for (const g of groups) for (const r of g.records) m.set(r.id, r);
    return m;
  }, [groups]);

  const recordLabel = (id: string): string => {
    const r = recordById.get(id);
    return r ? `${r.code ?? "—"} · ${r.name}` : id.slice(0, 8);
  };

  return (
    <PageShell>
      <PageHeader
        title="Mükerrer Kayıtlar"
        description="Aynı kaydın iki kez açılmış hâllerini bul, incele, tek kayda birleştir"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => csvMutation.mutate()}
              disabled={csvMutation.isPending || !scan}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV indir
            </Button>
            <Button variant="outline" size="sm" onClick={() => void scanQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Yeniden tara
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
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
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showNotDuplicate}
            onChange={(e) => setShowNotDuplicate(e.target.checked)}
          />
          "Mükerrer değil" denilenleri de göster
        </label>
      </div>

      {scan && (
        <div className="text-xs text-muted-foreground">
          {scan.totals.records} kayıt tarandı · {scan.totals.groups} grup / {scan.totals.pairs} çift
          {scan.totals.hiddenNotDuplicate > 0 && !showNotDuplicate
            ? ` · ${scan.totals.hiddenNotDuplicate} çift "mükerrer değil" olarak gizli`
            : ""}
          {" · "}
          benzer ad:{" "}
          {scan.fuzzyEnabled ? `açık, eşik %${scan.thresholdPct}` : "kapalı"} (Ayarlar → Müşteriler →
          Mükerrer kayıtlar)
        </div>
      )}

      {scanQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : scanQuery.isError ? (
        <Callout tone="danger" title="Tarama yapılamadı">
          {(scanQuery.error as Error).message}
        </Callout>
      ) : groups.length === 0 ? (
        <Callout tone="success" title="Aday bulunamadı">
          {MERGE_ENTITY_LABEL[entity]} listesinde aynı/benzer ad ya da kimlik çakışması taşıyan
          kayıt yok
          {scan && scan.totals.hiddenNotDuplicate > 0
            ? ` (${scan.totals.hiddenNotDuplicate} çift daha önce "mükerrer değil" denildi)`
            : ""}
          .
        </Callout>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">{g.records.length} kayıt</span>
                  {g.rules.map((r) => (
                    <Badge key={r} variant={r === "FUZZY_NAME" ? "outline" : "secondary"}>
                      {DUPLICATE_RULE_LABEL[r]}
                      {r === "FUZZY_NAME" && g.maxScore !== null
                        ? ` %${Math.round(g.maxScore * 100)}`
                        : ""}
                    </Badge>
                  ))}
                  {g.hasDeferred && (
                    <Badge variant="outline">
                      <Clock className="mr-1 h-3 w-3" />
                      ertelendi
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(g);
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
                    <span className="min-w-0">
                      <code className="text-xs text-muted-foreground">{r.code ?? "—"}</code>{" "}
                      {r.name}
                      {!r.isActive && (
                        <span className="ml-2 text-xs text-muted-foreground">(pasif)</span>
                      )}
                      {Object.entries(r.identity)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <span key={k} className="ml-2 text-xs text-muted-foreground">
                            {k}: {v}
                          </span>
                        ))}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {r.refCount === null ? "?" : r.refCount}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Çift gerekçeleri + çift başına karar */}
              <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
                {g.pairs.map((p) => (
                  <li key={p.pairKey} className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">
                      {p.evidence.map((e) => e.detail).join(" · ")}
                      {p.review && (
                        <span className="ml-2 font-medium">
                          [{p.review.decision === "NOT_DUPLICATE"
                            ? "mükerrer değil"
                            : p.review.decision === "DEFERRED"
                              ? "ertelendi"
                              : "birleştirildi"}
                          {p.review.decidedBy ? ` — ${p.review.decidedBy}` : ""}
                          {p.review.note ? `: ${p.review.note}` : ""}]
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {p.review && p.review.decision !== "MERGED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => reopenMutation.mutate(p.review!.id)}
                        >
                          <Undo2 className="mr-1 h-3 w-3" />
                          Geri aç
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setDecideFor({ pair: p, group: g, decision: "DEFERRED" });
                              setNote("");
                            }}
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Ertele
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setDecideFor({ pair: p, group: g, decision: "NOT_DUPLICATE" });
                              setNote("");
                            }}
                          >
                            <XCircle className="mr-1 h-3 w-3" />
                            Mükerrer değil
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* KARAR DİYALOĞU */}
      <Dialog open={Boolean(decideFor)} onOpenChange={(v) => !v && setDecideFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {decideFor?.decision === "NOT_DUPLICATE" ? "Mükerrer değil" : "Ertele"}
            </DialogTitle>
          </DialogHeader>
          {decideFor && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-2">
                <div>{recordLabel(decideFor.pair.aId)}</div>
                <div>{recordLabel(decideFor.pair.bId)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {decideFor.pair.evidence.map((e) => e.detail).join(" · ")}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {decideFor.decision === "NOT_DUPLICATE"
                  ? "Bu çift bir daha kuyruğa düşmez (filtreyle görülür, geri açılabilir). Kayıtlara dokunulmaz."
                  : "Çift kuyrukta 'ertelendi' işaretiyle kalır; karar sonra verilir."}
              </p>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Not (isteğe bağlı) — örn. farklı şirketler, VKN yanlış girilmiş"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideFor(null)}>
              Vazgeç
            </Button>
            <Button disabled={decideMutation.isPending} onClick={() => decideMutation.mutate()}>
              {decideMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BİRLEŞTİRME DİYALOĞU (mevcut onay kapısı) */}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && closeMerge()}>
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
                          // Hedef değişince alan seçimleri anlamını yitirir (öneriler
                          // yeni hedefe göre baştan hesaplanır) — sıfırla.
                          setFieldPicks({});
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
                  fieldPicks={fieldPicks}
                  onFieldPickChange={(field, recordId) =>
                    setFieldPicks((prev) => ({ ...prev, [field]: recordId }))
                  }
                />
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMerge}>
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
