import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Ruler } from "lucide-react";
import { toast } from "sonner";
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
import { FormField } from "@/components/forms/FormField";
import { colorService } from "@/pages/Colors/service";
import { workOrderService } from "./service";
import type { RollAttributeTarget } from "./types";

type Mode = "color" | "width";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  workOrderId: string;
  workOrderNumber: string;
  currentColorId: string | null;
  currentColorName: string | null;
  currentWidth: number | null;
}

/**
 * "Rengi Değiştir" / "Eni Değiştir" — iş emrinin TEK bir hedefini değiştiren
 * dar kapı (2026-08-17, madde 10 ve 12).
 *
 * Gerçek hayattaki karşılığı: iş emri boyahanedeyken müşteri telefon eder,
 * "maviyi değil ekruyu istiyoruz" der; ya da fasondan gelen mal 300 değil 295
 * cm ölçülür. İkisi de bugüne kadar "Düzenle" ekranından yapılıyordu — yani
 * sebebi de izi de tutulmuyordu ve aynı ekranda rota da bozulabiliyordu.
 *
 * SEBEP ZORUNLU: bu diyaloğun varlık sebebi izlenebilirlik. Sebepsiz
 * değiştirmek zaten mümkündü.
 */
export function ChangeTargetDialog({
  open,
  onOpenChange,
  mode,
  workOrderId,
  workOrderNumber,
  currentColorId,
  currentColorName,
  currentWidth,
}: Props) {
  const qc = useQueryClient();
  const [colorId, setColorId] = useState<string | null>(currentColorId);
  const [width, setWidth] = useState<string>(currentWidth != null ? String(currentWidth) : "");
  const [reason, setReason] = useState("");
  /** Seçili top id'leri — "bu değişiklik toplara da yansısın mı?" (madde 12). */
  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setColorId(currentColorId);
      setWidth(currentWidth != null ? String(currentWidth) : "");
      setReason("");
      setSelectedRolls(new Set());
    }
  }, [open, currentColorId, currentWidth]);

  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open && mode === "color",
    staleTime: 60_000,
  });

  // "Toplara da uygula" adayları. İş emri = PLAN, top = ÖLÇÜM: plan değişikliği
  // ölçümü kendiliğinden ezmez. Ama mal baştan yanlış kaydedilmiş olabilir, o
  // yüzden karar AYNI ekranda tek dokunuşla veriliyor (2026-08-17 kullanıcı
  // kararı) — ayrı bir ekrana gönderilseydi sahada unutulurdu.
  const targetsQ = useQuery({
    queryKey: ["work-order-roll-targets", workOrderId],
    queryFn: () => workOrderService.getRollAttributeTargets(workOrderId),
    enabled: open,
    staleTime: 30_000,
  });
  const batches = targetsQ.data?.data ?? [];
  const editableOf = (b: RollAttributeTarget) => b.rolls.filter((r) => !r.blocked);

  // ── MEVCUT DAĞILIM BANDI (2026-08-19, kullanıcı kararı) ────────────────────
  // Saha senaryosu: iş emri MAVİ açıldı, mal boyandı, müşteri "gri olacaktı"
  // dedi. Planlamacı hedefi GRİ'ye çevirirken elinde ZATEN 12 MAVİ top olduğunu
  // görmüyordu — renk değişikliği ona kâğıt işi gibi geliyordu, oysa boyanmış
  // mal için bu bir MAL kararıdır (redye / "mavi stok kalsın" dallanır).
  // Veri zaten roll-attribute-targets'tan geliyor; bant yalnız onu özetler.
  const allRolls = batches.flatMap((b) => b.rolls);
  const distribution = (() => {
    const counts = new Map<string, number>();
    for (const r of allRolls) {
      const key =
        mode === "color"
          ? (r.colorName ?? "renksiz")
          : r.width != null
            ? `${r.width} cm`
            : "en girilmemiş";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Çoktan aza — planlamacının gözü ilk kalemde ne çoğunluktaysa onu görsün.
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const toggleBatch = (b: RollAttributeTarget) => {
    const ids = editableOf(b).map((r) => r.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedRolls.has(id));
    setSelectedRolls((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  // Dönüş şekilleri farklı (`warnings` ↔ `previousWidth`) — ortak dar bir tipe
  // indiriyoruz; ekranın ihtiyacı yalnız mesaj ve varsa uyarılar.
  const mutation = useMutation<{ message?: string; data: { warnings?: string[] } }>({
    mutationFn: async () => {
      // İş emri ZATEN doğru değerdeyse plan yazımı atlanır ve yalnız toplar
      // düzeltilir. Bu, diyaloğu ikinci kez açan operatörün tek çıkış yolu:
      // aksi halde "değer değişmedi" diye kapıya takılır ve yanlış kaydedilmiş
      // topları hiçbir yerden düzeltemezdi.
      const res = !changed
        ? { message: undefined, data: {} as { warnings?: string[] } }
        : mode === "color"
          ? await workOrderService.changeTargetColor(workOrderId, colorId, reason)
          : await workOrderService.changeWidth(workOrderId, width === "" ? null : Number(width), reason);
      // Sıra ÖNEMLİ: önce plan, sonra toplar. Tersi olsaydı plan yazımı
      // düşünce toplar iş emriyle çelişen bir değere çekilmiş olurdu.
      if (selectedRolls.size > 0) {
        const applied = await workOrderService.applyAttributeToRolls(workOrderId, {
          rollIds: [...selectedRolls],
          ...(mode === "color" ? { colorId } : { width: width === "" ? null : Number(width) }),
          reason,
        });
        if (applied.data.updated > 0) toast.success(`${applied.data.updated} top güncellendi`);
        for (const f of applied.data.failed) {
          toast.warning(`${f.barcode ?? "barkodsuz"}: ${f.message}`);
        }
      }
      return {
        message: res.message ?? (selectedRolls.size > 0 ? "Toplar güncellendi" : "Güncellendi"),
        data: res.data as { warnings?: string[] },
      };
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      // Bağlı siparişlerle çelişki ENGEL DEĞİL, uyarıdır: kararı müşteri verdi.
      // Ama planlamacı sipariş satırını da düzeltmek isteyebilir → görünür kalsın.
      const warnings = (res.data as { warnings?: string[] }).warnings ?? [];
      for (const w of warnings) toast.warning(w);
      // ⚠️ Anahtarlar EKRANLARIN kullandığıyla birebir olmalı. İlk yazımda
      // `["work-order", id]` invalidate ediliyordu — böyle bir sorgu YOK:
      // liste tazeleniyor, yan panel ve detay sayfası ESKİ rengi göstermeye
      // devam ediyordu (2026-08-17 saha bildirimi, ekran görüntülü).
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onOpenChange(false);
    },
  });

  const isColor = mode === "color";
  const changed = isColor
    ? colorId !== currentColorId
    : (width === "" ? null : Number(width)) !== currentWidth;
  // Gönderilebilir: ya iş emri değeri değişiyor, ya da (değişmese bile) toplara
  // uygulanacak bir seçim var. İkisi de yoksa yapılacak bir şey yok.
  const canSubmit =
    (changed || selectedRolls.size > 0) && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isColor ? <Palette className="h-4 w-4" /> : <Ruler className="h-4 w-4" />}
            {isColor ? "Üretim Rengini Değiştir" : "Eni Değiştir"} — {workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            {isColor
              ? "Bu iş emrinin ÜRETİM rengi değişir. Bağlı siparişlerin rengi değişmez."
              : "Bu iş emrinin eni değişir; fason çekisinde basılan EN değeri buradan gelir."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Şu anki değer:{" "}
            <strong className="text-foreground">
              {isColor ? (currentColorName ?? "renksiz") : currentWidth != null ? `${currentWidth} cm` : "—"}
            </strong>
          </div>

          {allRolls.length > 0 && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-950/40">
              <span className="font-medium">Bu iş emrinde şu an: </span>
              {distribution.map(([label, count], i) => (
                <span key={label}>
                  {i > 0 && " · "}
                  <strong>{count} top</strong> {label}
                </span>
              ))}
              {isColor && (
                <div className="mt-1 text-muted-foreground">
                  Boyanmış mal için renk değişikliği kâğıt işi değildir — mal ya
                  boyahaneye döner (redye) ya da mevcut rengiyle stok kalır.
                </div>
              )}
            </div>
          )}

          {isColor ? (
            <FormField label="Yeni Renk" htmlFor="new-color">
              <select
                id="new-color"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={colorId ?? ""}
                onChange={(e) => setColorId(e.target.value || null)}
              >
                <option value="">— renksiz —</option>
                {(colorsQ.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Yeni En (cm)" htmlFor="new-width">
              <Input
                id="new-width"
                type="number"
                min={1}
                max={1000}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="örn: 295"
              />
            </FormField>
          )}

          <FormField
            label="Sebep"
            htmlFor="change-reason"
            required
            hint="Kayda geçer — 'müşteri telefonla istedi', 'kabulde ölçüldü' gibi."
          >
            <Input
              id="change-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Neden değişiyor?"
            />
          </FormField>

          {batches.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
                <span className="font-medium">Toplara da uygula</span>
                <span className="text-muted-foreground">
                  {selectedRolls.size > 0 ? `${selectedRolls.size} top seçili` : "seçili değil"}
                </span>
              </div>
              <div className="max-h-40 overflow-auto">
                {batches.map((b) => {
                  const editable = editableOf(b);
                  const blocked = b.rolls.length - editable.length;
                  const on = editable.length > 0 && editable.every((r) => selectedRolls.has(r.id));
                  return (
                    <label
                      key={b.batchId ?? "none"}
                      className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-accent/40"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={editable.length === 0}
                        onChange={() => toggleBatch(b)}
                      />
                      <span className="font-mono">{b.batchNumber ?? "Partisiz"}</span>
                      <span className="text-muted-foreground">{editable.length} top</span>
                      {blocked > 0 && (
                        <span className="ml-auto text-muted-foreground">
                          {blocked} uygun değil
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Kaydediliyor…" : "Değiştir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
