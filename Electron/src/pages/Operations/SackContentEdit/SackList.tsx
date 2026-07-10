import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, PackageMinus, PackageX } from "lucide-react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { packingService } from "./service";
import { invalidateShipmentData } from "./useShipmentDetail";
import { SackCard } from "./SackCard";
import { WeighSackDialog } from "./WeighSackDialog";
import { DeleteSackDialog } from "./DeleteSackDialog";
import { SackTargetPicker, type MoveTarget } from "./SackTargetPicker";
import { EDITABLE_STATUSES, type SackRoll, type ShipmentDetail, type ShipmentSack } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

interface SwapSource {
  rollId: string;
  label: string;
  sackId: string;
}

interface Props {
  detail: ShipmentDetail;
  /** Verilirse PREPARING'de aktif-çuval seçimi açılır (scan-in için). */
  activeSackId?: string | null;
  onSetActiveSack?: (sackId: string) => void;
  /**
   * true → düzenleme aksiyonları gizlenir (salt görüntüleme). Sevk Kapısı
   * slide-over'ı bunu "Düzelt" toggle'ı arkasında tutar — kapıda kazara içerik
   * değiştirip tartı sıfırlatma vakalarını azaltır. Paketleme workspace'i vermez.
   */
  editLocked?: boolean;
}

const rollLabel = (r: SackRoll) => r.barcode ?? `Açık Kumaş (${r.item.name})`;

/**
 * Çuval içeriği düzenleyici — paketleme workspace'i ve Çuval Depo slide-over'ı
 * paylaşır. Durum-güdümlü: PREPARING'de aktif-çuval/sil; PREPARING/READY/AT_DOOR'da
 * top çıkar/taşı/takas + yeniden-tartı; DISPATCHED/CANCELLED salt-okunur. READY/AT_DOOR'da
 * uyarı banner'ı (tartı sıfırlanır + karşılanma güncellenir).
 */
export function SackList({ detail, activeSackId, onSetActiveSack, editLocked }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("shipping:write");
  const { id: shipmentId, status } = detail;
  const canEdit = !editLocked && canWrite && EDITABLE_STATUSES.includes(status);
  const canScanIn = canWrite && status === "PREPARING" && !!onSetActiveSack;
  const committed = status === "READY" || status === "AT_DOOR";

  const looseRolls = detail.rolls.filter((r) => !r.sackId);
  const looseSwatches = detail.swatches.filter((s) => !s.sackId);

  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  const [weighTarget, setWeighTarget] = useState<ShipmentSack | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShipmentSack | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => void;
  } | null>(null);

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => packingService.removeRoll(shipmentId, rollId),
    onSuccess: () => {
      toast.success("Top çuvaldan çıkarıldı");
      invalidateShipmentData(qc, shipmentId);
      setConfirm(null);
    },
    onError: () => setConfirm(null),
  });
  const removeSwatchMut = useMutation({
    mutationFn: (swatchId: string) => packingService.removeSwatch(shipmentId, swatchId),
    onSuccess: () => {
      toast.success("Kartela çıkarıldı");
      invalidateShipmentData(qc, shipmentId);
      setConfirm(null);
    },
    onError: () => setConfirm(null),
  });
  const swapMut = useMutation({
    mutationFn: ({ a, b }: { a: string; b: string }) => packingService.swapRollSacks(a, b),
    onSuccess: () => {
      toast.success("Topların çuvalları takaslandı");
      invalidateShipmentData(qc, shipmentId);
      setSwapSource(null);
      setConfirm(null);
    },
    onError: () => setConfirm(null),
  });
  const mutPending = removeRollMut.isPending || removeSwatchMut.isPending || swapMut.isPending;

  const warn = committed
    ? " Sevkiyat çuval depoda/kapı önünde — değişiklikte etkilenen çuvalların tartısı sıfırlanır ve karşılanma güncellenir."
    : "";

  const handleRemoveRoll = (r: SackRoll) =>
    setConfirm({
      title: "Top çuvaldan çıkarılsın mı?",
      description: `${rollLabel(r)} serbest depoya dönecek.${warn}`,
      run: () => removeRollMut.mutate(r.id),
    });
  const handleRemoveSwatch = (s: { id: string; barcode: string | null }) =>
    setConfirm({
      title: "Kartela çıkarılsın mı?",
      description: `${s.barcode ?? "Kartela"} serbest depoya dönecek.${warn}`,
      run: () => removeSwatchMut.mutate(s.id),
    });
  const handleMoveRoll = (r: SackRoll, fromSackId: string | null) =>
    setMoveTarget({ rollId: r.id, rollLabel: rollLabel(r), fromSackId });

  const handleSwapRoll = (r: SackRoll, sackId: string) => {
    if (!swapSource) {
      setSwapSource({ rollId: r.id, label: rollLabel(r), sackId });
      return;
    }
    if (swapSource.rollId === r.id) {
      setSwapSource(null); // aynı topa tekrar bas → iptal
      return;
    }
    if (swapSource.sackId === sackId) {
      toast.info("İki top aynı çuvalda — takas anlamsız. Farklı çuvaldaki topu seçin.");
      return;
    }
    const a = swapSource;
    setConfirm({
      title: "İki topun çuvalı takaslansın mı?",
      description: `${a.label} ↔ ${rollLabel(r)}${warn}`,
      run: () => swapMut.mutate({ a: a.rollId, b: r.id }),
    });
  };

  return (
    <div className="space-y-3">
      {committed && canEdit && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Bu sevkiyat çuval depoda/kapı önünde. İçerik değişince etkilenen çuvalların{" "}
            <strong>tartısı sıfırlanır</strong> (yeniden tartı gerekir) ve sipariş{" "}
            <strong>karşılanması güncellenir</strong>.
          </span>
        </div>
      )}

      {swapSource && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <span>
            Takas: <strong>{swapSource.label}</strong> seçildi — başka çuvaldaki 2. topu seçin.
          </span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSwapSource(null)}>
            Vazgeç
          </Button>
        </div>
      )}

      {/* Çuvalsız (loose) top/kartela — sevke hazır için bir çuvala okutulmalı/taşınmalı */}
      {(looseRolls.length > 0 || looseSwatches.length > 0) && (
        <div className="rounded-md border border-dashed border-amber-400 bg-amber-50/50 p-3 dark:bg-amber-950/20">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <PackageX className="h-3.5 w-3.5" /> Çuvalsız {looseRolls.length} top
            {looseSwatches.length > 0 ? ` + ${looseSwatches.length} kartela` : ""} — bir çuvala
            okutun veya taşıyın
          </div>
          <ul className="space-y-1">
            {looseRolls.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1 text-[11px]"
              >
                <span className="truncate">
                  <span className="font-mono font-medium">{r.barcode ?? "Açık Kumaş"}</span>
                  <span className="ml-1 text-muted-foreground">
                    {r.item.name}
                    {r.color ? ` · ${r.color.name}` : ""} · {fmtM(r.currentQty)} m
                  </span>
                </span>
                {canEdit && (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => handleMoveRoll(r, null)}
                    >
                      Çuvala Taşı
                    </Button>
                    <button
                      type="button"
                      title="Çıkar"
                      aria-label="Çıkar"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setConfirm({
                          title: "Top sevkiyattan çıkarılsın mı?",
                          description: `${rollLabel(r)} serbest depoya dönecek.`,
                          run: () => removeRollMut.mutate(r.id),
                        })
                      }
                    >
                      <PackageMinus className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </li>
            ))}
            {looseSwatches.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded border border-dashed bg-background px-2 py-1 text-[11px]"
              >
                <span className="truncate">
                  <span className="font-mono font-medium">{s.barcode ?? "Kartela"}</span>
                  <span className="ml-1 text-muted-foreground">kartela</span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    title="Çıkar"
                    aria-label="Kartela çıkar"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveSwatch(s)}
                  >
                    <PackageMinus className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.sacks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Bu sevkiyatta çuval yok.</p>
      ) : (
        detail.sacks.map((sack) => (
          <SackCard
            key={sack.id}
            sack={sack}
            canEdit={canEdit}
            canScanIn={canScanIn}
            active={activeSackId === sack.id}
            swapSourceRollId={swapSource?.rollId ?? null}
            onSetActive={(id) => onSetActiveSack?.(id)}
            onRemoveRoll={handleRemoveRoll}
            onMoveRoll={handleMoveRoll}
            onSwapRoll={handleSwapRoll}
            onRemoveSwatch={handleRemoveSwatch}
            onWeigh={setWeighTarget}
            onDelete={setDeleteTarget}
          />
        ))
      )}

      <WeighSackDialog
        shipmentId={shipmentId}
        sack={weighTarget}
        onOpenChange={(o) => !o && setWeighTarget(null)}
      />
      <DeleteSackDialog
        shipmentId={shipmentId}
        sack={deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />
      <SackTargetPicker
        shipmentId={shipmentId}
        target={moveTarget}
        sacks={detail.sacks}
        onOpenChange={(o) => !o && setMoveTarget(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !mutPending && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel="Onayla"
        destructive
        isPending={mutPending}
        onConfirm={() => confirm?.run()}
      />
    </div>
  );
}
