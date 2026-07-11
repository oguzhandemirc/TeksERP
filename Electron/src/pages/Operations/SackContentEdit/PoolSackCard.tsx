import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Lock, LockOpen, Scale, Sticker, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { packingService } from "./service";
import { invalidatePoolData } from "./useCustomerPool";
import { WeighSackDialog } from "./WeighSackDialog";
import { DeleteSackDialog } from "./DeleteSackDialog";
import { AddKartelaDialog } from "./AddKartelaDialog";
import type { PoolSack } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  sack: PoolSack;
  customerId: string;
  active?: boolean;
  onSetActive?: () => void;
  otherOpenSacks: PoolSack[];
}

/** Havuz çuvalı kartı — açık çuval düzenlenir (okut/çıkar/taşı/tart/mühürle), mühürlü read-only + aç. */
export function PoolSackCard({ sack, customerId, active, onSetActive, otherOpenSacks }: Props) {
  const qc = useQueryClient();
  const [weighOpen, setWeighOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [kartelaOpen, setKartelaOpen] = useState(false);
  const invalidate = () => invalidatePoolData(qc, customerId);

  const sealMut = useMutation({
    mutationFn: () => packingService.sealSack(sack.id),
    onSuccess: () => {
      invalidate();
      toast.success("Çuval mühürlendi — çuval depo havuzunda");
    },
  });
  const reopenMut = useMutation({
    mutationFn: () => packingService.reopenSack(sack.id),
    onSuccess: () => {
      invalidate();
      toast.success("Mühür açıldı — düzenlenebilir");
    },
  });
  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRollFromSack(rollId),
    onSuccess: () => invalidate(),
  });
  const moveRollMut = useMutation({
    mutationFn: (vars: { rollId: string; sackId: string }) => packingService.moveRollToSack(vars.rollId, vars.sackId),
    onSuccess: () => {
      invalidate();
      toast.success("Top taşındı");
    },
  });

  const canSeal = !sack.sealed && sack.rollCount + sack.swatchCount > 0 && !!sack.manualCode;

  return (
    <div className={cn("rounded-lg border bg-card", active && "border-primary/60 bg-primary/5")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="font-medium">{sack.manualCode ?? sack.sackNo}</span>
        {sack.manualCode && <Badge variant="outline" className="font-mono text-[10px]">{sack.sackNo}</Badge>}
        <Badge variant={sack.sealed ? "default" : "secondary"} className="text-[10px]">
          {sack.sealed ? "Mühürlü (havuzda)" : "Açık"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {sack.rollCount} top · {fmtM(sack.totalQty)} m
          {sack.swatchCount > 0 ? ` · ${sack.swatchCount} kartela` : ""}
          {sack.weightKg != null ? ` · ${sack.weightKg} kg` : ""}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {!sack.sealed && onSetActive && !active && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSetActive}>
              Aktif Yap
            </Button>
          )}
          {!sack.sealed && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Kartela ekle" onClick={() => setKartelaOpen(true)}>
                <Sticker className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Tart / kod" onClick={() => setWeighOpen(true)}>
                <Scale className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Çuvalı sil" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button size="sm" className="h-7 text-xs" disabled={!canSeal || sealMut.isPending} onClick={() => sealMut.mutate()}>
                <Lock className="mr-1 h-3.5 w-3.5" /> Mühürle
              </Button>
            </>
          )}
          {sack.sealed && (
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={reopenMut.isPending} onClick={() => reopenMut.mutate()}>
              <LockOpen className="mr-1 h-3.5 w-3.5" /> Mührü Aç
            </Button>
          )}
        </div>
      </div>

      {!sack.sealed && !canSeal && sack.rollCount + sack.swatchCount > 0 && !sack.manualCode && (
        <div className="border-b bg-amber-500/5 px-4 py-1.5 text-xs text-amber-600">
          Mühürlemek için önce çuval kodu girin (Tart / kod).
        </div>
      )}

      <div className="px-4 py-2">
        {sack.rolls.length === 0 && sack.swatches.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Boş çuval — top okutun.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {sack.rolls.map((r) => (
                <tr key={r.id} className="border-b border-dashed last:border-0">
                  <td className="py-1 font-mono">{r.barcode}</td>
                  <td className="py-1">{r.item.name}</td>
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1.5">
                      {r.color?.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: r.color.hex }} />}
                      {r.color?.name ?? "Ham"}
                    </span>
                  </td>
                  <td className="py-1 text-right">{r.width ? `${r.width} cm` : "—"}</td>
                  <td className="py-1 text-right">{fmtM(r.currentQty)} m</td>
                  {!sack.sealed && (
                    <td className="py-1 text-right">
                      {otherOpenSacks.length > 0 && (
                        <select
                          className="mr-1 h-6 rounded border bg-background px-1 text-[11px]"
                          value=""
                          onChange={(e) => e.target.value && moveRollMut.mutate({ rollId: r.id, sackId: e.target.value })}
                          title="Başka çuvala taşı"
                        >
                          <option value="">Taşı…</option>
                          {otherOpenSacks.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.manualCode ?? o.sackNo}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Çıkar (depoya döner)" onClick={() => removeRollMut.mutate(r.id)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {sack.swatches.map((s) => (
                <tr key={s.id} className="border-b border-dashed text-muted-foreground last:border-0">
                  <td className="py-1 font-mono">{s.barcode}</td>
                  <td className="py-1">{s.item.name} (kartela)</td>
                  <td className="py-1">{s.color?.name ?? "—"}</td>
                  <td className="py-1 text-right">—</td>
                  <td className="py-1 text-right">—</td>
                  {!sack.sealed && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canSeal && (
        <div className="flex items-center gap-1.5 border-t bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Mühürlemeye hazır ({sack.manualCode})
        </div>
      )}

      <WeighSackDialog sack={weighOpen ? sack : null} customerId={customerId} onOpenChange={setWeighOpen} />
      <DeleteSackDialog sack={deleteOpen ? sack : null} customerId={customerId} onOpenChange={setDeleteOpen} />
      <AddKartelaDialog sackId={kartelaOpen ? sack.id : null} customerId={customerId} onOpenChange={setKartelaOpen} />
    </div>
  );
}
