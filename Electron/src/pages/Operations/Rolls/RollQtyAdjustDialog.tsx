import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ruler, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { qtyAdjustService } from "./qtyAdjustService";
import type { Roll } from "./types";

interface Props {
  /** Düzeltilecek top — null = kapalı. */
  roll: Roll | null;
  onOpenChange: (open: boolean) => void;
  /** Başarılı düzeltmeden sonra (detay panelini tazelemek için). */
  onAdjusted?: () => void;
}

const fmt = (n: number): string => n.toLocaleString("tr-TR", { useGrouping: false });

/**
 * "Metraj Düzelt" (G4, ticaret paketi) — SAYIM düzeltmesi: kayıtlı 500 m'lik
 * top rafta 480 m çıktı. YALNIZ `currentQty` değişir (initialQty tarihsel giriş
 * kaydıdır); iz RollVariance sapma defteri + audit + `labelDirty`.
 *
 * ⚠️ `RollEditDialog` ("Düzelt") ile KARIŞTIRMA — o fabrika-paylaşımlı ÖLÇÜM
 * düzeltmesi yüzeyidir (bütün topta initialQty'yi de yazar). Bu diyalog yalnız
 * ticaret rejiminde çizilir (`canAdjustRollQty` yüklemi, bekçili).
 *
 * Yıkıcı-işlem onayı DİYALOĞUN KENDİSİDİR: etkilenen tek somut kayıt (barkod +
 * kumaş) ve eski → yeni → fark özeti gönderilmeden önce ekranda durur — soyut
 * "1 kayıt etkilenecek" yok.
 */
export function RollQtyAdjustDialog({ roll, onOpenChange, onAdjusted }: Props) {
  const open = Boolean(roll);
  const qc = useQueryClient();
  const [qtyStr, setQtyStr] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setQtyStr("");
      setReason("");
    }
  }, [open]);

  const oldQty = roll ? Number(roll.currentQty) : 0;
  // ⚠️ Sayı `Number()` ile okunur (input type=number nokta ondalıklıdır) —
  // tr-TR biçimli metin parse edilmez (W3 dersi: Number("1.250")=1,25 tuzağı
  // burada doğamaz çünkü kullanıcı serbest metin değil number input yazar).
  const newQty = qtyStr.trim() === "" ? null : Number(qtyStr);
  const validQty = newQty != null && Number.isFinite(newQty) && newQty > 0;
  const diff = validQty ? newQty! - oldQty : 0;
  const isShort = diff < 0;
  const canSubmit =
    Boolean(roll) && validQty && diff !== 0 && reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () =>
      qtyAdjustService.adjust(roll!.id, { newQty: newQty!, reason: reason.trim() }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Metraj düzeltildi.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onAdjusted?.();
      onOpenChange(false);
    },
    // onError YOK: apiClient interceptor'ı 4xx'te backend mesajını zaten basar
    // (kapsam dışı / çuvalda / eşzamanlı değişiklik 409'ları somut Türkçe konuşur).
  });

  const summary = useMemo(() => {
    if (!validQty || diff === 0) return null;
    return {
      label: isShort
        ? "Kayıt düzeltmesi — sayım kayıtlıdan DÜŞÜK"
        : "Fazlalık — sayım kayıtlıdan YÜKSEK",
      hint: isShort
        ? "Eksik metraj sapma defterine 'kayıt düzeltmesi' olarak yazılır (fire DEĞİL)."
        : "Fazla metraj sapma defterine 'fazlalık' (OVERAGE) olarak yazılır.",
    };
  }, [validQty, diff, isShort]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-4 w-4" /> Metraj Düzelt (sayım)
          </DialogTitle>
          <DialogDescription>
            Fiziksel sayımda ölçülen gerçek metrajı yaz. Yalnız mevcut metraj değişir;
            giriş kaydı (başlangıç metrajı) korunur. Sebep zorunlu — sapma defterine yazılır.
          </DialogDescription>
        </DialogHeader>

        {roll && (
          <div className="space-y-4">
            {/* Etkilenen somut kayıt — yıkıcı-işlem kuralı. */}
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{roll.item?.name ?? "—"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {roll.barcode ? (
                  <span className="font-mono">{roll.barcode}</span>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Açık Kumaş</Badge>
                )}
                {roll.color?.name && <span>· {roll.color.name}</span>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Kayıtlı metraj: <span className="font-semibold tabular-nums">{fmt(oldQty)} m</span>
                {Number(roll.initialQty) !== oldQty && (
                  <span> · Başlangıç: {fmt(Number(roll.initialQty))} m</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qty-adjust-new">Sayımda ölçülen metraj (m)</Label>
              <Input
                id="qty-adjust-new"
                type="number"
                min={0.001}
                step="0.01"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                placeholder={`Örn. ${fmt(oldQty)}`}
              />
              {validQty && diff === 0 && (
                <p className="text-xs text-muted-foreground">
                  Yeni metraj kayıtla aynı — düzeltilecek fark yok.
                </p>
              )}
            </div>

            {summary && (
              <div
                className={
                  isShort
                    ? "flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-3 text-xs text-amber-800"
                    : "flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50/50 p-3 text-xs text-sky-800"
                }
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1">
                  <div className="font-medium">{summary.label}</div>
                  <div className="tabular-nums">
                    {fmt(oldQty)} m → {fmt(newQty!)} m · Fark: {diff > 0 ? "+" : "−"}
                    {fmt(Math.abs(diff))} m
                  </div>
                  <div>{summary.hint} Topun etiketi "güncel değil" işaretlenir.</div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="qty-adjust-reason">İşlem Nedeni (zorunlu)</Label>
              <Input
                id="qty-adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Örn. yıl sonu sayımı — rafta eksik ölçüldü"
                maxLength={500}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "..." : "Metrajı Düzelt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
