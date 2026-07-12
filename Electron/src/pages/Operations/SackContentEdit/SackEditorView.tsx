import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Layers, Lock, RefreshCw, Scale, Trash2, UserRound, X } from "lucide-react";
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
import type { EditorTarget } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * Tek çuval editörü (Çuval Depo modeli) — mühür YOK, depodaki çuval her zaman
 * düzenlenebilir. Okut (ekle/taşı) · tart · kartela ekle · top çıkar/taşı · sil.
 */
export function SackEditorView({ target, onExit }: { target: EditorTarget; onExit: () => void }) {
  const qc = useQueryClient();
  const contentsQ = useSackContents(target.sackId);
  const data = contentsQ.data?.data;
  const rolls = data?.rolls ?? [];
  const swatches = data?.swatches ?? [];
  const locked = !!data?.shipment; // sevkiyata atanmışsa içerik kilitli
  const totalQty = rolls.reduce((a, r) => a + Number(r.currentQty), 0);

  // Taşıma hedefleri — aynı müşterinin diğer depo çuvalları (müşterisizde yok).
  const poolQ = useCustomerPool(target.customerId);
  const otherSacks = useMemo(
    () => (poolQ.data?.data.sacks ?? []).filter((s) => s.id !== target.sackId).map((s) => ({ id: s.id, sackNo: s.sackNo })),
    [poolQ.data, target.sackId],
  );

  const [weighOpen, setWeighOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => sackHubService.removeRollFromSack(rollId),
    onSuccess: () => invalidateSackHub(qc),
  });
  const removeSwatchMut = useMutation({
    mutationFn: (swatchId: string) => sackHubService.removeSwatchFromSack(swatchId),
    onSuccess: () => invalidateSackHub(qc),
  });
  const moveRollMut = useMutation({
    mutationFn: (v: { rollId: string; sackId: string }) => sackHubService.moveRollToSack(v.rollId, v.sackId),
    onSuccess: () => {
      invalidateSackHub(qc);
      toast.success("Top taşındı");
    },
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
      <div className="flex-1 overflow-auto p-6">
        {contentsQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : rolls.length === 0 && swatches.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {target.isNew ? "Yeni çuval boş." : "Çuval boş."} Yukarıdan top/kartela okutarak doldurun.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Barkod</th>
                  <th className="px-3 py-2 font-medium">Ürün</th>
                  <th className="px-3 py-2 font-medium">Renk</th>
                  <th className="px-3 py-2 text-right font-medium">En</th>
                  <th className="px-3 py-2 text-right font-medium">Metre</th>
                  <th className="px-3 py-2 text-right font-medium">Kalite</th>
                  {!locked && <th className="px-3 py-2 text-right font-medium">İşlem</th>}
                </tr>
              </thead>
              <tbody>
                {rolls.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{r.barcode ?? "Açık Kumaş"}</td>
                    <td className="px-3 py-1.5">{r.item.name}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        {r.color?.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: r.color.hex }} />}
                        {r.color?.name ?? "Ham"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.width ? `${r.width} cm` : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtM(Number(r.currentQty))} m</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{r.qualityGrade}</td>
                    {!locked && (
                      <td className="px-3 py-1.5 text-right">
                        {otherSacks.length > 0 && (
                          <select
                            className="mr-1 h-7 rounded border bg-background px-1 text-xs"
                            value=""
                            onChange={(e) => e.target.value && moveRollMut.mutate({ rollId: r.id, sackId: e.target.value })}
                            title="Başka çuvala taşı"
                          >
                            <option value="">Taşı…</option>
                            {otherSacks.map((o) => (
                              <option key={o.id} value={o.id}>{o.sackNo}</option>
                            ))}
                          </select>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Çıkar (depoya döner)"
                          disabled={removeRollMut.isPending}
                          onClick={() => removeRollMut.mutate(r.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {swatches.map((s) => (
                  <tr key={s.id} className="border-b text-muted-foreground last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{s.barcode ?? "Kartela"}</td>
                    <td className="px-3 py-1.5">{s.item.name} (kartela)</td>
                    <td className="px-3 py-1.5">{s.color?.name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    {!locked && (
                      <td className="px-3 py-1.5 text-right">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}
