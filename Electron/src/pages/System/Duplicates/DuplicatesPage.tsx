import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Download, History, Merge, RefreshCw, Search, Undo2, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadBlob } from "@/lib/file-save";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { MergeHistoryDialog } from "./MergeHistoryDialog";
import { RollDuplicatesTab } from "./RollDuplicatesTab";
import {
  DUPLICATE_RULE_LABEL,
  MERGE_ENTITIES,
  MERGE_ENTITY_LABEL,
  mergeService,
  type DuplicatePairEvidence,
  type DuplicateRecordRow,
  type MergeEntity,
} from "@/services/mergeService";

/**
 * MÜKERRER KAYITLAR — v3: ANA EKRAN ARTIK TAM LİSTE (2026-08-22).
 *
 * ⚠️ v2'de ekran "öneri listesi"ydi ve kullanıcı geri bildirimi netti:
 * *"sistemin verdiği önerileri sevmedim; tüm cari listesini göreyim, arasından
 * kendim seçip birleştireyim"*. O kurguda motor bir çifti bulamazsa kullanıcı
 * BİLDİĞİ hâlde birleştiremiyordu — panelin tek girişi öneriydi.
 *
 * Yeni kurgu: liste varlığın TAMAMIDIR, şüpheliler onun üzerinde bir SÜZGEÇ
 * (⚠ rozeti). Seçim serbesttir: iki satırı işaretle, birleştir. Sistem hiçbir
 * şeyi dayatmaz, yalnız işaretler.
 *
 * ⚠️ Karar düğmeleri (Ertele / Mükerrer değil) LİSTEDE DEĞİL karşılaştırma
 * diyaloğunda: "bu ikisi aynı mı" sorusuna iki kaydı YAN YANA görmeden cevap
 * verilmez. Listede karar vermek, v2'de operatörü tam da o körlükle bırakıyordu.
 *
 * ⚠️ Şüpheli grup üyeleri sunucuda BİTİŞİK sıralanır (`listRecords`) — sayfalama
 * bir çifti ikiye bölerse operatör eşini hiç görmez.
 */
export function DuplicatesPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialEntity = MERGE_ENTITIES.includes(
    (searchParams.get("entity") ?? "") as MergeEntity,
  )
    ? (searchParams.get("entity") as MergeEntity)
    : "customer";
  // "roll" bir MergeEntity DEĞİL — ayrı sekme, ayrı FİİL (birleştirme değil iptal).
  const [tab, setTab] = useState<MergeEntity | "roll">(initialEntity);
  const entity: MergeEntity = tab === "roll" ? initialEntity : tab;

  const [rawSearch, setRawSearch] = useState("");
  const search = useDebouncedValue(rawSearch, 300);
  const [onlySuspect, setOnlySuspect] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showNotDuplicate, setShowNotDuplicate] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  // Süzgeç değişince sayfa başa döner; seçim KORUNUR (kullanıcı arama yapıp
  // ikinci kaydı bulmak isteyebilir — seçimi silmek onu sıfırdan başlatırdı).
  useEffect(() => {
    setPage(1);
  }, [search, onlySuspect, includeInactive, showNotDuplicate, entity]);

  // Birleştirme diyaloğu
  const [mergeOpen, setMergeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState<string | null>(null);

  // Karar diyaloğu
  const [decideFor, setDecideFor] = useState<{
    aId: string;
    bId: string;
    decision: "NOT_DUPLICATE" | "DEFERRED";
    evidence: DuplicatePairEvidence[];
  } | null>(null);
  const [note, setNote] = useState("");

  const listQuery = useQuery({
    queryKey: [
      "duplicate-records",
      entity,
      search,
      onlySuspect,
      includeInactive,
      showNotDuplicate,
      page,
    ],
    queryFn: () =>
      mergeService.records(entity, {
        search: search || undefined,
        onlySuspect,
        includeInactive,
        includeNotDuplicate: showNotDuplicate,
        page,
        limit: 50,
      }),
    refetchOnMount: "always",
    enabled: tab !== "roll",
  });
  const list = listQuery.data?.data;
  const rows = useMemo(() => list?.rows ?? [], [list]);

  const rowById = useMemo(() => {
    const m = new Map<string, DuplicateRecordRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["duplicate-records"] });
    void qc.invalidateQueries({ queryKey: ["duplicate-candidates"] });
    void qc.invalidateQueries({ queryKey: ["duplicates"] });
  };

  const decideMutation = useMutation({
    mutationFn: () =>
      mergeService.decide({
        entity,
        aId: decideFor!.aId,
        bId: decideFor!.bId,
        decision: decideFor!.decision,
        note: note.trim() || null,
        evidence: decideFor!.evidence,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Karar kaydedildi.");
      setDecideFor(null);
      setNote("");
      setSelected([]);
      closeMerge();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => mergeService.reopen(id),
    onSuccess: () => {
      toast.success("Karar geri açıldı — çift yeniden şüpheli listesinde.");
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
    setMergeOpen(false);
    setSurvivorId(null);
  }

  /** Birleştirmeyi aç — KALACAK varsayılanı en çok kullanılan kayıt. */
  function openMerge(ids: string[]): void {
    const best = [...ids]
      .map((id) => rowById.get(id))
      .filter(Boolean)
      .sort((a, b) => (b!.refCount ?? 0) - (a!.refCount ?? 0))[0];
    setSurvivorId(best?.id ?? ids[0] ?? null);
    setMergeOpen(true);
  }

  const toggle = (id: string): void =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** Rozete tıklayınca grubun TÜM üyeleri seçilir (çift tek tuşla kurulur). */
  const selectGroup = (r: DuplicateRecordRow): void => {
    if (!r.suspect) return;
    setSelected([...new Set([r.id, ...r.suspect.partnerIds])]);
  };

  /** Karşılaştırmadaki iki kayıt bilinen bir ŞÜPHELİ çift mi (karar verilebilir). */
  const decidablePair = useMemo(() => {
    if (selected.length !== 2) return null;
    const [a, b] = selected;
    const ra = rowById.get(a!);
    if (!ra?.suspect?.partnerIds.includes(b!)) return null;
    return { aId: a!, bId: b!, evidence: [] as DuplicatePairEvidence[] };
  }, [selected, rowById]);

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

  return (
    <PageShell>
      <PageHeader
        title="Mükerrer Kayıtlar"
        description="Listeden istediğin kayıtları seç ve tek kayda birleştir; sistem şüphelileri ⚠ ile işaretler"
        actions={
          tab === "roll" ? null : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => csvMutation.mutate()}
                disabled={csvMutation.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                CSV indir
              </Button>
              <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Yenile
              </Button>
              {/* Birleştirme artık deftere yazılıyor → geçmişten geri alınabilir. */}
              <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                <History className="mr-2 h-4 w-4" />
                Birleştirme Geçmişi
              </Button>
            </div>
          )
        }
      />

      <PageBody className="space-y-4 p-6">
        {/* SEKMELER — segment kontrol */}
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
          {MERGE_ENTITIES.map((e) => (
            <TabButton
              key={e}
              active={e === tab}
              onClick={() => {
                setTab(e);
                setSelected([]);
              }}
            >
              {MERGE_ENTITY_LABEL[e]}
            </TabButton>
          ))}
          <TabButton active={tab === "roll"} onClick={() => setTab("roll")}>
            Toplar (hayalet kayıt)
          </TabButton>
        </div>

        {tab === "roll" && <RollDuplicatesTab />}

        {tab !== "roll" && (
          <>
            {/* ARAÇ KARTI — arama + süzgeçler üst satır, özet + seçim alt satır */}
            <div className="rounded-lg border bg-card shadow-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={`${MERGE_ENTITY_LABEL[entity]} ara — ad veya kod`}
                    value={rawSearch}
                    onChange={(e) => setRawSearch(e.target.value)}
                  />
                </div>
                <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1">
                  <TabButton active={onlySuspect} onClick={() => setOnlySuspect(true)}>
                    Şüpheliler
                    {list ? (
                      <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[11px]">
                        {list.suspectTotal}
                      </Badge>
                    ) : null}
                  </TabButton>
                  <TabButton active={!onlySuspect} onClick={() => setOnlySuspect(false)}>
                    Tümü
                  </TabButton>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={includeInactive}
                      onCheckedChange={(v) => setIncludeInactive(v === true)}
                    />
                    Pasifleri de göster
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={showNotDuplicate}
                      onCheckedChange={(v) => setShowNotDuplicate(v === true)}
                    />
                    “Mükerrer değil” denilenler
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-3 py-2">
                {list && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{list.total}</span> kayıt ·{" "}
                    <span className="font-medium text-foreground">{list.suspectTotal}</span> şüpheli
                    · benzer ad:{" "}
                    {list.fuzzyEnabled ? `açık, eşik %${list.thresholdPct}` : "kapalı"} (Ayarlar →
                    Müşteriler → Mükerrer kayıtlar)
                  </p>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {selected.length > 0 && (
                    <>
                      <Badge variant="outline">{selected.length} seçili</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                        Temizle
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    disabled={selected.length < 2}
                    onClick={() => openMerge(selected)}
                  >
                    <Merge className="mr-2 h-4 w-4" />
                    Birleştir
                  </Button>
                </div>
              </div>
            </div>

            {listQuery.isLoading ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : listQuery.isError ? (
              <Callout tone="danger" title="Liste alınamadı">
                {(listQuery.error as Error).message}
              </Callout>
            ) : rows.length === 0 ? (
              <Callout tone="success" title={onlySuspect ? "Şüpheli kayıt yok" : "Kayıt bulunamadı"}>
                {onlySuspect
                  ? `${MERGE_ENTITY_LABEL[entity]} listesinde aynı/benzer ad ya da kimlik çakışması taşıyan kayıt yok. Kendin birleştirmek istersen “Tümü”ne geç.`
                  : "Arama sonucu boş."}
              </Callout>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="w-40">Kod</TableHead>
                      <TableHead>Ad</TableHead>
                      <TableHead className="w-28 text-right">Kullanım</TableHead>
                      <TableHead className="w-24">Durum</TableHead>
                      <TableHead className="w-48">Şüphe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const isSel = selected.includes(r.id);
                      return (
                        <TableRow
                          key={r.id}
                          className={isSel ? "bg-muted/50" : undefined}
                          onClick={() => toggle(r.id)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={isSel} onCheckedChange={() => toggle(r.id)} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.code ?? "—"}
                          </TableCell>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-right">
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Users className="h-3 w-3" />
                              {r.refCount === null ? "?" : r.refCount.toLocaleString("tr-TR")}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.isActive ? "aktif" : "pasif"}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {r.suspect ? (
                              <button
                                type="button"
                                className="flex flex-wrap items-center gap-1 text-left"
                                onClick={() => selectGroup(r)}
                                title={`${r.suspect.details.join("\n")}\n\nTıkla: bu grubun tümünü seç`}
                              >
                                {r.suspect.rules.map((rule) => (
                                  <Badge
                                    key={rule}
                                    variant={rule === "FUZZY_NAME" ? "outline" : "secondary"}
                                  >
                                    {DUPLICATE_RULE_LABEL[rule]}
                                    {rule === "FUZZY_NAME" && r.suspect!.maxScore !== null
                                      ? ` %${Math.round(r.suspect!.maxScore * 100)}`
                                      : ""}
                                  </Badge>
                                ))}
                              </button>
                            ) : null}
                            {/* Verilmiş karar + geri açma. Kararı görünür kılmayan
                                liste "mükerrer değil"i TEK YÖNLÜ kapıya çevirirdi. */}
                            {r.suspect?.reviews
                              .filter((rv) => rv.decision !== "MERGED")
                              .map((rv) => (
                                <span key={rv.id} className="mt-1 flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs">
                                    {rv.decision === "NOT_DUPLICATE" ? "mükerrer değil" : "ertelendi"}
                                    {rv.decidedBy ? ` — ${rv.decidedBy}` : ""}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1.5 text-xs"
                                    title={rv.note ?? undefined}
                                    onClick={() => reopenMutation.mutate(rv.id)}
                                  >
                                    <Undo2 className="mr-1 h-3 w-3" />
                                    Geri aç
                                  </Button>
                                </span>
                              ))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {list && totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 pt-1 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Önceki
                </Button>
                <span className="text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sonraki
                </Button>
              </div>
            )}
          </>
        )}
      </PageBody>

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
                <div>{rowById.get(decideFor.aId)?.name ?? decideFor.aId.slice(0, 8)}</div>
                <div>{rowById.get(decideFor.bId)?.name ?? decideFor.bId.slice(0, 8)}</div>
              </div>
              <p className="text-xs text-muted-foreground">
                {decideFor.decision === "NOT_DUPLICATE"
                  ? "Bu çift bir daha şüpheli listesine düşmez (filtreyle görülür, geri açılabilir). Kayıtlara dokunulmaz."
                  : "Çift listede 'ertelendi' işaretiyle kalır; karar sonra verilir."}
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

      {/* BİRLEŞTİRME — ORTAK diyalog (Tanımlar listeleri de aynısını açar). */}
      <MergeHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entity={tab === "roll" ? "customer" : tab}
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={(v) => {
          if (!v) closeMerge();
        }}
        entity={entity}
        ids={selected}
        preferredSurvivorId={survivorId}
        onMerged={() => setSelected([])}
        extraActions={
          decidablePair ? (
            <div className="flex flex-wrap gap-2 rounded-md border border-dashed p-2">
              <span className="text-xs text-muted-foreground">
                Aynı kayıt değillerse birleştirme:
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDecideFor({ ...decidablePair, decision: "NOT_DUPLICATE" });
                  setNote("");
                }}
              >
                <XCircle className="mr-1 h-3 w-3" />
                Mükerrer değil
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDecideFor({ ...decidablePair, decision: "DEFERRED" });
                  setNote("");
                }}
              >
                <Clock className="mr-1 h-3 w-3" />
                Ertele
              </Button>
            </div>
          ) : null
        }
      />

    </PageShell>
  );
}

/** Segment kontrol düğmesi — sekme ve Şüpheliler/Tümü anahtarı aynı görünümü paylaşır. */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
