import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Keyboard, Layers, Loader2, Lock, MessageSquareText, PackageOpen, RefreshCw, Scale, Tag, Trash2, UserRound, UserRoundCog, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub, useSackContents } from "./useSackData";
import { EditorScanBar } from "./EditorScanBar";
import { WeighSackDialog } from "./WeighSackDialog";
import { AddKartelaDialog } from "./AddKartelaDialog";
import { DeleteSackDialog } from "./DeleteSackDialog";
import { DistributeSackDialog } from "./DistributeSackDialog";
import { ReassignCustomerDialog, type ReassignPatch } from "./ReassignCustomerDialog";
import { SackContentsTable } from "./SackContentsTable";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { fromDumpRows } from "./sackDump";
import { SackNoteDialog } from "./SackNoteDialog";
import { useSackWeighAction } from "./useSackWeighAction";
import { StaleLabelsBanner } from "./StaleLabelsBanner";
import { SackLabelDialog } from "@/components/labels/SackLabelDialog";
import type { EditorTarget } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * Tek çuval editörü (Çuval Depo modeli) — mühür YOK, depodaki çuval her zaman
 * düzenlenebilir. Okut (ekle/taşı) · tart · kartela ekle · içeriği seç → depoya
 * çıkar / başka çuvala aktar (SackContentsTable) · çuvalı dağıt · sil.
 */
export function SackEditorView({
  target,
  onExit,
  onReassigned,
}: {
  target: EditorTarget;
  onExit: () => void;
  onReassigned: (patch: ReassignPatch) => void;
}) {
  const qc = useQueryClient();
  const contentsQ = useSackContents(target.sackId);
  const data = contentsQ.data?.data;
  const rolls = data?.rolls ?? [];
  const swatches = data?.swatches ?? [];
  const locked = !!data?.shipment; // sevkiyata atanmışsa içerik kilitli
  const totalQty = rolls.reduce((a, r) => a + Number(r.currentQty), 0);
  const hasContents = rolls.length > 0 || swatches.length > 0;

  const [weighOpen, setWeighOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Tartı: tek dokunuş (oku → doğrudan kaydet). Elle giriş ⌄ menüsünde.
  const sackWeigh = useSackWeighAction();

  const removeSwatchMut = useMutation({
    mutationFn: (swatchId: string) => sackHubService.removeSwatchFromSack(swatchId),
    onSuccess: () => invalidateSackHub(qc),
  });

  return (
    <PageShell>
      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" /> Listeye Dön
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-semibold">{target.sackNo}</span>
              {target.customerName ? (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <UserRound className="h-3 w-3" /> {target.customerName}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">Müşterisiz (genel stok)</Badge>
              )}
              {target.branchName && <Badge variant="secondary" className="text-[10px]">{target.branchName}</Badge>}
              {target.branchCode && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/40 font-mono text-[10px] text-amber-600"
                  title="Şube ihracat kodu — sevk belgesinde 'İhracat Kodu' olarak basılır"
                >
                  İhracat Kodu: {target.branchCode}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {rolls.length} top · {fmtM(totalQty)} m
              {swatches.length > 0 ? ` · ${swatches.length} kartela` : ""}
              {data?.weightKg != null ? ` · ${data.weightKg} kg` : " · tartılmadı"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void contentsQ.refetch()} disabled={contentsQ.isFetching}>
            <RefreshCw className={cn("mr-1 h-4 w-4", contentsQ.isFetching && "animate-spin")} /> Yenile
          </Button>
          {/* Etiket kilitli çuvalda DA basılabilir — baskı içeriği değiştirmez ve
              sevkteki çuvalın etiketi yırtılırsa yenisi gerekir. */}
          <Button variant="outline" size="sm" onClick={() => setLabelOpen(true)}>
            <Tag className="mr-1 h-4 w-4" /> Etiket
          </Button>
          {/* İçerik dökümü — SEÇİM GEREKMEZ, çuvalın tamamını alır. Kilitli çuvalda
              da açık (Etiket/Not ile aynı gerekçe: baskı içeriği değiştirmez).
              Tek dropdown olduğu için başlığa üç tuş değil bir tuş biner.

              Bellekteki `contentsQ` verisi DEĞİL, liste ekranıyla AYNI uç kullanılır:
              (a) "top fiziksel olarak çuvalda mı" kararı tek yerde (backend
              `SACK_ABSENT_STATUSES`) kalır — editör tablosu hayalet topu bilerek
              GÖSTERİR, belge ise saymaz; istemcide statü listesi kopyalamayız.
              (b) baskı her seferinde TAZE veriyle çıkar (çeki listesi diyaloğuyla
              aynı gerekçe: bayat kg/içerik kağıda gitmesin). */}
          <SackContentDumpMenu
            label="İçerik Dökümü"
            disabled={!data || !hasContents}
            hasNotes={!!data?.notes}
            load={async () => fromDumpRows((await sackHubService.contentDump([target.sackId])).data)}
          />
          {/* Yorum kilitli çuvalda DA düzenlenebilir (annotation; içerik/ölçüm değil).
              Not varsa buton "Notu Düzenle" olur — içerik modalda okunur, ekranda
              yer kaplamaz. */}
          <Button variant="outline" size="sm" onClick={() => setNoteOpen(true)}>
            <MessageSquareText className="mr-1 h-4 w-4" />
            {data?.notes ? "Notu Düzenle" : "Not Ekle"}
          </Button>
          {!locked && (
            <>
              <Button variant="outline" size="sm" onClick={() => setReassignOpen(true)}>
                <UserRoundCog className="mr-1 h-4 w-4" /> Müşteri
              </Button>
              <Button variant="outline" size="sm" onClick={() => setKartelaOpen(true)}>
                <Layers className="mr-1 h-4 w-4" /> Kartela
              </Button>
              {/* TEK DOKUNUŞ tartı: kantardan oku → doğrudan kaydet (diyalog YOK).
                  Elle giriş yanındaki ⌄ menüsünde — kantar bozuksa kaçış yolu. */}
              <div className="flex">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-r-none border-r-0"
                  disabled={sackWeigh.busy}
                  title={
                    sackWeigh.hasScale
                      ? "Kantardan oku ve kaydet"
                      : "Kantar tanımlı değil — ⌄ menüsünden elle girin"
                  }
                  onClick={() => data && void sackWeigh.weigh({ id: data.id, sackNo: data.sackNo })}
                >
                  <Scale className={cn("mr-1 h-4 w-4", sackWeigh.busy && "animate-pulse")} />
                  {sackWeigh.busy ? "Tartılıyor…" : "Tart"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-l-none px-1.5"
                      aria-label="Tartı seçenekleri"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setWeighOpen(true)}>
                      <Keyboard className="mr-2 h-4 w-4" /> Elle kg gir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {hasContents && (
                <Button variant="outline" size="sm" onClick={() => setDistributeOpen(true)}>
                  <PackageOpen className="mr-1 h-4 w-4" /> Dağıt
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Sil
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Etiketi bayatlayan toplar VARSA uyarı + tek tuşla yeniden bas. Yoksa
          bileşen null döner, hiç yer kaplamaz. */}
      <StaleLabelsBanner
        rolls={rolls}
        customerId={target.customerId}
        customerName={target.customerName}
      />

      {/* Not VARSA tek satırlık şerit — yoksa hiç yer kaplamaz (boş input yok). */}
      {data?.notes && (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          title="Notu düzenle"
          className="flex w-full items-start gap-2 border-b bg-amber-50/60 px-6 py-2 text-left text-xs text-amber-900 hover:bg-amber-50 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/40"
        >
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words italic">{data.notes}</span>
        </button>
      )}

      {locked ? (
        <div className="px-6 py-3">
          <Callout tone="warning" icon={Lock} title="Bu çuval bir sevkiyata atanmış">
            İçeriği kilitli. Düzenlemek için önce Sevk Kapısı'nda çuvalı sevkiyattan çıkarın.
            (Yorum yine düzenlenebilir.)
          </Callout>
        </div>
      ) : (
        <EditorScanBar sackId={target.sackId} />
      )}

      {/* İçerik — liste ekranlarıyla aynı: DataTable alanı TAM kaplar (p-6/çerçeve yok). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {contentsQ.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : (
          <>
            <SackContentsTable
              sackId={target.sackId}
              rolls={rolls}
              locked={locked}
              sourceCustomerId={target.customerId}
              sourceCustomerName={target.customerName}
            />

            {swatches.length > 0 && (
              <div className="border-t">
                <div className="bg-muted/40 px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kartelalar · {swatches.length}
                </div>
                <ul className="max-h-48 divide-y overflow-y-auto text-sm">
                  {swatches.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-6 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">{s.barcode ?? "Kartela"}</span>
                        <span className="text-muted-foreground">
                          {s.item.name}
                          {s.color ? ` · ${s.color.name}` : ""}
                        </span>
                      </span>
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Kartelayı çıkar"
                          disabled={removeSwatchMut.isPending}
                          onClick={() => removeSwatchMut.mutate(s.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <WeighSackDialog
        sack={weighOpen && data ? { id: data.id, sackNo: data.sackNo, weightKg: data.weightKg } : null}
        onOpenChange={setWeighOpen}
      />
      <SackLabelDialog
        sack={labelOpen && data ? { id: data.id, sackNo: data.sackNo } : null}
        onOpenChange={setLabelOpen}
      />
      <SackNoteDialog
        sack={noteOpen && data ? { id: data.id, sackNo: data.sackNo, notes: data.notes } : null}
        onOpenChange={setNoteOpen}
      />
      <AddKartelaDialog sackId={kartelaOpen ? target.sackId : null} onOpenChange={setKartelaOpen} />
      <DeleteSackDialog
        sack={deleteOpen && data ? { id: data.id, sackNo: data.sackNo, rolls, swatches } : null}
        onOpenChange={setDeleteOpen}
        onDeleted={onExit}
      />
      <DistributeSackDialog
        sack={distributeOpen && data ? { id: data.id, sackNo: data.sackNo, rollCount: rolls.length, swatchCount: swatches.length } : null}
        onOpenChange={setDistributeOpen}
        onDistributed={(deleted) => {
          if (deleted) onExit();
        }}
      />
      <ReassignCustomerDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        sackId={target.sackId}
        initialCustomerId={target.customerId}
        initialBranchId={target.branchId}
        onReassigned={onReassigned}
      />
    </PageShell>
  );
}
