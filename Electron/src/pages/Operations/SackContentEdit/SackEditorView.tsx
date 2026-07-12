import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Layers, Loader2, Lock, PackageOpen, RefreshCw, Scale, Trash2, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub, useCustomerPool, useSackContents } from "./useSackData";
import { EditorScanBar } from "./EditorScanBar";
import { WeighSackDialog } from "./WeighSackDialog";
import { AddKartelaDialog } from "./AddKartelaDialog";
import { DeleteSackDialog } from "./DeleteSackDialog";
import { DistributeSackDialog } from "./DistributeSackDialog";
import { SackContentsTable } from "./SackContentsTable";
import type { EditorTarget } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * Tek çuval editörü (Çuval Depo modeli) — mühür YOK, depodaki çuval her zaman
 * düzenlenebilir. Okut (ekle/taşı) · tart · kartela ekle · içeriği seç → depoya
 * çıkar / başka çuvala aktar (SackContentsTable) · çuvalı dağıt · sil.
 */
export function SackEditorView({ target, onExit }: { target: EditorTarget; onExit: () => void }) {
  const qc = useQueryClient();
  const contentsQ = useSackContents(target.sackId);
  const data = contentsQ.data?.data;
  const rolls = data?.rolls ?? [];
  const swatches = data?.swatches ?? [];
  const locked = !!data?.shipment; // sevkiyata atanmışsa içerik kilitli
  const totalQty = rolls.reduce((a, r) => a + Number(r.currentQty), 0);
  const hasContents = rolls.length > 0 || swatches.length > 0;

  // Taşıma hedefleri — aynı müşterinin diğer depo çuvalları (müşterisizde yok).
  const poolQ = useCustomerPool(target.customerId);
  const otherSacks = useMemo(
    () => (poolQ.data?.data.sacks ?? []).filter((s) => s.id !== target.sackId).map((s) => ({ id: s.id, sackNo: s.sackNo })),
    [poolQ.data, target.sackId],
  );

  const [weighOpen, setWeighOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);

  const removeSwatchMut = useMutation({
    mutationFn: (swatchId: string) => sackHubService.removeSwatchFromSack(swatchId),
    onSuccess: () => invalidateSackHub(qc),
  });

  return (
    <div className="flex h-full flex-col">
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
          {!locked && (
            <>
              <Button variant="outline" size="sm" onClick={() => setKartelaOpen(true)}>
                <Layers className="mr-1 h-4 w-4" /> Kartela
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeighOpen(true)}>
                <Scale className="mr-1 h-4 w-4" /> Tart
              </Button>
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

      {locked ? (
        <div className="px-6 py-3">
          <Callout tone="warning" icon={Lock} title="Bu çuval bir sevkiyata atanmış">
            İçeriği kilitli. Düzenlemek için önce Sevk Kapısı'nda çuvalı sevkiyattan çıkarın.
          </Callout>
        </div>
      ) : (
        <EditorScanBar sackId={target.sackId} />
      )}

      {/* İçerik */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {contentsQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
              <SackContentsTable sackId={target.sackId} rolls={rolls} locked={locked} targets={otherSacks} />
            </div>

            {swatches.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kartelalar · {swatches.length}
                </div>
                <ul className="divide-y text-sm">
                  {swatches.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
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
    </div>
  );
}
