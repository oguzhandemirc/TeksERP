import { useEffect, useMemo, useState } from "react";
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
import { orderService } from "@/pages/Operations/Orders/service";
import { useTabsStore } from "@/store/tabs";
import { workOrderService } from "./service";
import { TebdilWizard } from "./tebdil/TebdilWizard";
import type { RollAttributeTarget, WorkOrder } from "./types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { showServerWarnings } from "@/lib/serverNotes";

type Mode = "color" | "width";
/** Renkle uyuşmayan bağlı sipariş için karar: uyar (bağ kalır) · bağı kopar · siparişi de düzelt. */
type OrderAction = "warn" | "unlink" | "update";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  workOrderId: string;
  workOrderNumber: string;
  currentColorId: string | null;
  currentColorName: string | null;
  currentWidth: number | null;
  /** Bağlı siparişler — renk uyumsuzluğu ÖNCEDEN gösterilir ve karar burada verilir. */
  orderLinks?: WorkOrder["orderLinks"];
}

const PARTIAL_CODE = "COLOR_PARTIAL_CONFIRM";
const DYED_BLOCKED_CODE = "COLOR_DYED_BLOCKED";
const NEW_WO_PATH = "/operations/work-orders/new";

/** Axios hatasından backend `message` + `details.code` (varsa) okur. */
function readApiError(err: unknown): { code: string | null; message: string } {
  const e = err as {
    response?: { data?: { message?: string; details?: { code?: string } } };
    message?: string;
  };
  return {
    code: e?.response?.data?.details?.code ?? null,
    message: e?.response?.data?.message ?? e?.message ?? "İşlem başarısız",
  };
}

/**
 * "Rengi Değiştir" / "Eni Değiştir" — iş emrinin TEK bir hedefini değiştiren
 * dar kapı (2026-08-17, madde 10 ve 12).
 *
 * Gerçek hayattaki karşılığı: iş emri boyahanedeyken müşteri telefon eder,
 * "maviyi değil ekruyu istiyoruz" der. Plan değişir; boyahaneden DÖNECEK toplar
 * kabulde yeni rengi kendiliğinden alır. ZATEN boyanmış mal için bu bir mal
 * kararıdır: ya kayıt yanlıştı (toplara uygula) ya yeniden boyanır (Tebdil).
 *
 * 2026-08-21 (kullanıcı kararı, "sade/özet olsun"):
 *   • Bant DURUMA GÖRE konuşur: fasondaki renksiz toplar → "kabulde yeni rengi
 *     alır"; boyanmış toplar → "seç → kaydı düzelt / Tebdil". Tek genel cümle yok.
 *   • PLANLAMACI TOPLU DÜZELTME: "beyaz diye kaydedilmiş mal aslında ekru" →
 *     Tümünü seç + yeni renk + sebep → plan + tüm açık kumaşlar tek hamlede
 *     düzelir; Tambur renkle uğraşmaz. Bekçi seçili topları yeni renkte sayar
 *     (`recolorRollIds`), bu yüzden boya bitmiş olsa da kayıt düzeltmesi geçer.
 *   • Sipariş uyumsuzluğu ÖNCEDEN listelenir; satır başına karar: uyar · bağı
 *     kopar · siparişi de düzelt (dar uç, sebep+audit).
 *   • Backend tek bekçi: bitmiş iş emri / izinli renk dışı → hata metni aynen;
 *     bir kısım top eski renkte + boyanacak top var → 409 onay ("Yine de
 *     değiştir"); mal zaten boyandı, boyanacak yok, yeni renkle uyuşmuyor → 409
 *     KAPALI: Tebdil (yeniden boya) / Yeni iş emri / Tümünü seç düğmeleri.
 *
 * SEBEP ZORUNLU: bu diyaloğun varlık sebebi izlenebilirlik.
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
  orderLinks,
}: Props) {
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [colorId, setColorId] = useState<string | null>(currentColorId);
  const [width, setWidth] = useState<string>(currentWidth != null ? String(currentWidth) : "");
  const [reason, setReason] = useState("");
  /** Seçili top id'leri — "bu değişiklik toplara da yansısın mı?" (madde 12). */
  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set());
  /** Backend'in "N top zaten X boyandı, kalan Y gelecek" onayı — metni sunucu yazar. */
  const [partialConfirm, setPartialConfirm] = useState<string | null>(null);
  /** Backend'in "mal zaten boyandı, boyanacak yok" kapısı — Tebdil / yeni iş emri. */
  const [dyedBlocked, setDyedBlocked] = useState<string | null>(null);
  /** Uyumsuz sipariş satırı → karar (varsayılan: uyar, bağ kalır). */
  const [orderActions, setOrderActions] = useState<Record<string, OrderAction>>({});
  /** Tebdil sihirbazı (kapalı durumdan açılır) — hangi parti. */
  const [tebdilBatch, setTebdilBatch] = useState<{ id: string; number: string } | null>(null);

  useEffect(() => {
    if (open) {
      setColorId(currentColorId);
      setWidth(currentWidth != null ? String(currentWidth) : "");
      setReason("");
      setSelectedRolls(new Set());
      setPartialConfirm(null);
      setDyedBlocked(null);
      setOrderActions({});
      setTebdilBatch(null);
    }
  }, [open, currentColorId, currentWidth]);

  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      loadAllForPicker(colorService, {
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
  const allEditableIds = useMemo(
    () => batches.flatMap((b) => editableOf(b).map((r) => r.id)),
    [batches],
  );
  const allSelected = allEditableIds.length > 0 && allEditableIds.every((id) => selectedRolls.has(id));

  const isColor = mode === "color";
  const changed = isColor
    ? colorId !== currentColorId
    : (width === "" ? null : Number(width)) !== currentWidth;
  const newColorName = useMemo(
    () => (colorId ? (colorsQ.data?.data ?? []).find((c) => c.id === colorId)?.name ?? null : null),
    [colorId, colorsQ.data],
  );

  // ── DURUM BANDI (2026-08-21): üç kova, yalnız dolu olanlar yazılır ──────────
  const allRolls = batches.flatMap((b) => b.rolls);
  const atSubCount = allRolls.filter((r) => r.status === "AT_SUBCONTRACTOR").length;
  const dyedEditable = allRolls.filter((r) => !r.blocked && r.colorName != null);
  const dyedByColor = (() => {
    const counts = new Map<string, number>();
    for (const r of dyedEditable) counts.set(r.colorName!, (counts.get(r.colorName!) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const otherBlockedCount = allRolls.filter((r) => r.blocked && r.status !== "AT_SUBCONTRACTOR").length;
  const widthDistribution = (() => {
    const counts = new Map<string, number>();
    for (const r of allRolls) {
      const key = r.width != null ? `${r.width} cm` : "en girilmemiş";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();
  /** Boyanmış top içeren ilk parti — Tebdil düğmesinin hedefi. */
  const tebdilCandidate = useMemo(() => {
    const b = batches.find((x) => x.batchId && x.rolls.some((r) => !r.blocked && r.colorName != null));
    return b?.batchId ? { id: b.batchId, number: b.batchNumber ?? "Parti" } : null;
  }, [batches]);

  // ── SİPARİŞ UYUMSUZLUĞU — önceden, satır başına karar ─────────────────────
  const mismatchedLinks = useMemo(() => {
    if (!isColor || !changed) return [];
    return (orderLinks ?? []).filter(
      (l) => l.orderLine && (l.orderLine.colorId ?? null) !== colorId,
    );
  }, [isColor, changed, orderLinks, colorId]);

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
    setDyedBlocked(null);
  };
  const toggleAll = () => {
    setSelectedRolls(allSelected ? new Set() : new Set(allEditableIds));
    setDyedBlocked(null);
  };

  const mutation = useMutation<{ done: boolean; message?: string; warnings: string[] }, unknown, { confirmPartial: boolean }>({
    mutationFn: async ({ confirmPartial }) => {
      const warnings: string[] = [];
      // ① Plan. İş emri ZATEN doğru değerdeyse plan yazımı atlanır ve yalnız
      // toplar düzeltilir (diyaloğu ikinci kez açan operatörün tek çıkış yolu).
      let message: string | undefined;
      if (changed) {
        try {
          if (isColor) {
            const res = await workOrderService.changeTargetColor(workOrderId, colorId, reason, {
              confirmPartial,
              // Seçili toplar yeni renkte sayılır — "hepsini düzelt" kayıt düzeltmesi olarak geçer.
              recolorRollIds: [...selectedRolls],
            });
            message = res.message;
            warnings.push(...(res.data.warnings ?? []));
          } else {
            const res = await workOrderService.changeWidth(workOrderId, width === "" ? null : Number(width), reason);
            message = res.message;
          }
        } catch (err) {
          const { code, message: msg } = readApiError(err);
          if (code === PARTIAL_CODE && !confirmPartial) {
            setPartialConfirm(msg); // sunucu onay istiyor — "Yine de değiştir"
            return { done: false, warnings: [] };
          }
          if (code === DYED_BLOCKED_CODE) {
            setDyedBlocked(msg); // kapalı — Tebdil / yeni iş emri / tümünü seç
            return { done: false, warnings: [] };
          }
          throw err;
        }
      }
      // ② Toplar — sıra ÖNEMLİ: önce plan, sonra toplar. Tersi olsaydı plan
      // yazımı düşünce toplar iş emriyle çelişen bir değere çekilmiş olurdu.
      if (selectedRolls.size > 0) {
        const applied = await workOrderService.applyAttributeToRolls(workOrderId, {
          rollIds: [...selectedRolls],
          ...(isColor ? { colorId } : { width: width === "" ? null : Number(width) }),
          reason,
        });
        if (applied.data.updated > 0) toast.success(`${applied.data.updated} top güncellendi`);
        for (const f of applied.data.failed) toast.warning(`${f.barcode ?? "barkodsuz"}: ${f.message}`);
      }
      // ③ Sipariş kararları (yalnız renk). Her biri kendi başına meşru; biri
      // düşerse diğerleri yapılır, düşen uyarıyla söylenir.
      for (const l of mismatchedLinks) {
        const action = orderActions[l.orderLineId] ?? "warn";
        const orderNo = l.orderLine?.order?.orderNumber ?? "sipariş";
        try {
          if (action === "unlink") {
            await workOrderService.unlinkOrderLine(workOrderId, l.orderLineId);
            toast.success(`${orderNo} bağı kaldırıldı`);
          } else if (action === "update" && l.orderLine?.order?.id) {
            await orderService.changeLineColor(l.orderLine.order.id, l.orderLineId, colorId, reason);
            toast.success(`${orderNo} kalemi de ${newColorName ?? "renksiz"} yapıldı`);
          }
        } catch (err) {
          toast.warning(`${orderNo}: ${readApiError(err).message}`);
        }
      }
      // Sipariş uyumsuzluğu burada karara bağlandı — sunucunun aynı konudaki
      // metin uyarısı tekrar basılmaz; geri kalan (rota kapsaması vb.) gösterilir.
      const rest = warnings.filter((w) => !/siparişi .* istiyor\.$/.test(w));
      return { done: true, message, warnings: rest };
    },
    onSuccess: (res) => {
      if (!res.done) return; // onay / kapalı — diyalog açık kalır
      toast.success(res.message ?? (selectedRolls.size > 0 ? "Toplar güncellendi" : "Güncellendi"));
      showServerWarnings(res); // özel sonuç nesnesi (zarf değil) — genel basım görmez
      // ⚠️ Anahtarlar EKRANLARIN kullandığıyla birebir olmalı (2026-08-17 dersi).
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-roll-targets", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(readApiError(err).message);
    },
  });

  // Gönderilebilir: ya iş emri değeri değişiyor, ya da (değişmese bile) toplara
  // uygulanacak bir seçim var. İkisi de yoksa yapılacak bir şey yok.
  const canSubmit =
    (changed || selectedRolls.size > 0) && reason.trim().length >= 3 && !mutation.isPending;

  const newLabel = isColor ? (newColorName ?? "renksiz") : width ? `${width} cm` : "—";

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
              ? "İş emrinin üretim rengi değişir. Boyahaneden dönecek toplar kabulde yeni rengi alır."
              : "İş emrinin eni değişir; fason çekisinde basılan EN değeri buradan gelir."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Şu anki değer:{" "}
            <strong className="text-foreground">
              {isColor ? (currentColorName ?? "renksiz") : currentWidth != null ? `${currentWidth} cm` : "—"}
            </strong>
          </div>

          {/* Durum bandı — yalnız dolu kovalar, kısa cümleler */}
          {isColor && allRolls.length > 0 && (
            <ul className="space-y-0.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-950/40">
              {atSubCount > 0 && (
                <li>
                  <strong>{atSubCount} top</strong> boyahanede — kabulde yeni rengi alır.
                </li>
              )}
              {dyedByColor.map(([name, count]) => (
                <li key={name}>
                  <strong>{count} top</strong> zaten <strong>{name}</strong> boyanmış — kayıt yanlışsa aşağıdan
                  seç (Tümünü seç); yeniden boyanacaksa <strong>Tebdil</strong>.
                </li>
              ))}
              {otherBlockedCount > 0 && (
                <li className="text-muted-foreground">
                  {otherBlockedCount} top değişmez (sevk edildi / kesildi / iptal).
                </li>
              )}
            </ul>
          )}
          {!isColor && allRolls.length > 0 && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-950/40">
              <span className="font-medium">Bu iş emrinde şu an: </span>
              {widthDistribution.map(([label, count], i) => (
                <span key={label}>
                  {i > 0 && " · "}
                  <strong>{count} top</strong> {label}
                </span>
              ))}
            </div>
          )}

          {isColor ? (
            <FormField label="Yeni Renk" htmlFor="new-color">
              <select
                id="new-color"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={colorId ?? ""}
                onChange={(e) => {
                  setColorId(e.target.value || null);
                  setPartialConfirm(null);
                  setDyedBlocked(null);
                }}
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

          {/* Sipariş uyumsuzluğu — önceden, satır başına karar */}
          {mismatchedLinks.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b px-3 py-1.5 text-xs font-medium">
                Bağlı sipariş farklı renk istiyor
              </div>
              <div className="divide-y">
                {mismatchedLinks.map((l) => {
                  const orderNo = l.orderLine?.order?.orderNumber ?? "—";
                  const wants = l.orderLine?.color?.name ?? "renksiz";
                  const action = orderActions[l.orderLineId] ?? "warn";
                  return (
                    <div key={l.orderLineId} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="font-mono">{orderNo}</span>
                      <span className="text-muted-foreground">{wants} istiyor</span>
                      <select
                        className="ml-auto h-7 rounded-md border bg-background px-2 text-xs"
                        value={action}
                        onChange={(e) =>
                          setOrderActions((prev) => ({ ...prev, [l.orderLineId]: e.target.value as OrderAction }))
                        }
                        aria-label={`${orderNo} için karar`}
                      >
                        <option value="warn">Bağ kalsın (uyarı)</option>
                        <option value="unlink">Bağı kopar</option>
                        <option value="update">Siparişi de {newLabel} yap</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {batches.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
                <span className="font-medium">Toplara da uygula</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {selectedRolls.size > 0 ? `${selectedRolls.size} top seçili` : "seçili değil"}
                  {allEditableIds.length > 0 && (
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-[11px] hover:bg-accent"
                      onClick={toggleAll}
                    >
                      {allSelected ? "Temizle" : "Tümünü seç"}
                    </button>
                  )}
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

          {/* Backend onayı: bir kısım top zaten eski renkte, boyanacak top var */}
          {partialConfirm && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
              <div className="font-medium">Onay gerekiyor</div>
              <div className="mt-0.5">{partialConfirm}</div>
            </div>
          )}

          {/* Backend kapısı: mal zaten boyandı, boyanacak top yok */}
          {dyedBlocked && (
            <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
              <div className="font-medium">Bu iş emrinde mal zaten boyandı</div>
              <div>{dyedBlocked}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                {tebdilCandidate && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setTebdilBatch(tebdilCandidate)}>
                    Tebdil — yeniden boya
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    navigateActive(NEW_WO_PATH);
                  }}
                >
                  Yeni iş emri aç
                </Button>
                {allEditableIds.length > 0 && !allSelected && (
                  <Button type="button" size="sm" variant="outline" onClick={toggleAll}>
                    Kayıt yanlış — tüm topları {newLabel} yap
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          {partialConfirm ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!canSubmit}
              onClick={() => mutation.mutate({ confirmPartial: true })}
            >
              {mutation.isPending ? "Kaydediliyor…" : "Yine de değiştir"}
            </Button>
          ) : (
            <Button type="button" disabled={!canSubmit} onClick={() => mutation.mutate({ confirmPartial: false })}>
              {mutation.isPending ? "Kaydediliyor…" : "Değiştir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Kapalı durumdan Tebdil (yeniden boya / yeni iş emrine ayır) — parti şeridindeki sihirbazın aynısı. */}
      {tebdilBatch && (
        <TebdilWizard
          open={Boolean(tebdilBatch)}
          onOpenChange={(o) => {
            if (!o) {
              setTebdilBatch(null);
              onOpenChange(false);
            }
          }}
          workOrderId={workOrderId}
          batchId={tebdilBatch.id}
          batchNumber={tebdilBatch.number}
        />
      )}
    </Dialog>
  );
}
