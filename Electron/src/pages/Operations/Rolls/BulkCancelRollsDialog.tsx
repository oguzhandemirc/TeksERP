import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Flame, FileX2, Loader2, Ban, Tag, Factory } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { safeFormat } from "@/lib/format";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { rollService } from "./service";
import type { Roll } from "./types";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * STOKTAN KALDIRMANIN İKİ ANLAMI (2026-08-25 kullanıcı kararı).
 *
 * Bunlar bir "seçenek" değil, iki ayrı iş kararıdır ve ERP'de ayrı durmaları
 * standarttır (SAP karşılıkları: ters kayıt / MBST vs fire mal çıkışı / 551):
 *
 *   • CANCEL — "bu kayıt hiç olmamalıydı": yanlış giriş, mükerrer, yanlış metraj.
 *     Mal fiziksel olarak YOKTU → stok düşmez (hiç girmemişti), fire raporuna
 *     GİRMEZ. Sahadaki 230 iptalin sebep yazılmış 24'ünün tamamı bu.
 *   • SCRAP — "mal vardı, artık yok": yandı, kirlendi, numune gitti. Stok
 *     gerçekten düşer, fire oranına GİRER.
 *
 * ⚠️ Tek tuşa indirme. Veri düzeltmesini fireye yazmak fabrikanın fire oranını
 * doğrudan yalanlar — ve o oran müşteriye/maliyete konuşulan bir sayıdır.
 */
type Mode = "CANCEL" | "SCRAP";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rolls: Roll[];
  /** İşlem sonrası (kısmi bile olsa) — tabloyu/seçimi tazelemek için. */
  onDone?: () => void;
}

/**
 * Ham stoktan toplu kaldırma — iptal (kayıt hatası) veya fire (mal vardı).
 *
 * ⚠️ NEDEN ÖNİZLEME VAR: yıkıcı-işlem kuralı (CLAUDE.md) "etkilenen her kaydı
 * somut listele" der. Eski pencere topları körlemesine deniyor, hata sebebini
 * `catch {}` ile yutuyor ve yalnız "1 başarısız" yazıyordu — operatör NE olduğunu
 * hiçbir yerden öğrenemiyordu. Artık her top için `cancel-preview` sorulur:
 * engelli olanlar denenmez ve sebepleri (fasonda / sevkte / çuvalda) satırında
 * yazar.
 *
 * ⚠️ ÖLÜ ETİKET ONAYI YOK (2026-08-25): backend guard'ı kaldırıldı. Etiket bilgisi
 * satırda BİLGİ olarak durur — hangi kâğıtları depodan toplayacağını gösterir —
 * ama hiçbir şeyi kilitlemez.
 */
export function BulkCancelRollsDialog({ open, onOpenChange, rolls, onDone }: Props) {
  const qc = useQueryClient();
  // Fire GERÇEK bir stok değeri kararıdır → `roll:manual-adjust` (iş emri kapanış
  // dispozisyonlarıyla aynı çizgi; `roll:write` YETMEZ). İzni olmayana şıkkı
  // GÖSTERMEK, tıklayıp 403 almak demekti — kart↔route hizası kuralının aynısı.
  const { hasPermission } = useRoleAccess();
  const canScrap = hasPermission("roll:manual-adjust");
  const [mode, setMode] = useState<Mode>("CANCEL");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  // Her top için ayrı önizleme: uç tekildir ve toplu bir kardeşi yok. Sayı UX
  // capiyle (200) sınırlı olduğu için paralel N istek kabul edilebilir.
  const previews = useQueries({
    queries: rolls.map((r) => ({
      queryKey: ["roll-cancel-preview", r.id],
      queryFn: () => rollService.cancelPreview(r.id).then((res) => res.data),
      enabled: open,
      staleTime: 30_000,
    })),
  });
  const previewsLoading = previews.some((p) => p.isLoading);

  const presets = useQuery({
    queryKey: ["reason-presets", "bulk-remove"],
    queryFn: () => reasonPresetService.list(false),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const reasonOptions = useMemo(
    () =>
      (presets.data ?? [])
        .filter((p) => p.kind === (mode === "SCRAP" ? "ROLL_SCRAP" : "ROLL_CANCEL"))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [presets.data, mode],
  );

  // Önizleme + top eşleşmesi. Önizleme henüz gelmediyse top "izinli" sayılır
  // (fail-open DEĞİL — buton zaten önizleme yüklenene kadar pasif).
  const rows = rolls.map((r, i) => ({ roll: r, preview: previews[i]?.data ?? null }));
  const allowed = rows.filter((x) => x.preview?.canCancel !== false);
  const blocked = rows.filter((x) => x.preview?.canCancel === false);
  const labelled = allowed.filter((x) => x.preview?.labelPrinted);
  // İptalde sebep zorunluluğu (bayrak) SUNUCUDAN okunur, tahmin edilmez: önizlemelerden biri bile `reasonRequired`
  // diyorsa (bayrak kurulum geneli — hepsi aynı) İPTAL kipinde sebep seçilmeden düğme kapalı; fire ayrı karar, etkilenmez.
  const reasonRequired = mode === "CANCEL" && rows.some((x) => x.preview?.reasonRequired === true);
  const reasonMissing = reasonRequired && reasonCode === "";

  const run = async () => {
    const targets = allowed;
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    // Sebep hem METİN hem KOD olarak gider: kod rapor anahtarıdır ve ASLA
    // değişmez, metin fabrikanın o günkü etiketidir (kod↔metin ayrımı
    // `ReasonPreset` sözleşmesi). Kodu bilerek metinden türetmiyoruz.
    const chosen = reasonOptions.find((p) => p.code === reasonCode);
    const payload = chosen ? { reason: chosen.fullText ?? chosen.label, reasonCode: chosen.code } : undefined;
    const failed: string[] = [];
    for (const { roll } of targets) {
      try {
        if (mode === "SCRAP") await rollService.scrap(roll.id, payload);
        else await rollService.cancel(roll.id, payload);
        ok++;
      } catch (e) {
        // ⚠️ SEBEP YUTULMAZ. Eski kod burada `catch {}` yapıyordu ve pencere
        // "1 başarısız" deyip susuyordu; operatör 25.08'de tam bu yüzden neyin
        // engellediğini göremedi.
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          "bilinmeyen hata";
        failed.push(`${roll.barcode ?? roll.id}: ${msg}`);
      }
      setProgress({ done: ok + failed.length, total: targets.length });
    }
    await qc.invalidateQueries({ queryKey: ["rolls"] });
    const verb = mode === "SCRAP" ? "fire edildi" : "stoktan kaldırıldı";
    if (failed.length === 0) {
      // ⚠️ NEREYE GİTTİĞİNİ SÖYLE. Kayıt silinmiyor, arşive düşüyor — ama arşiv
      // Sistem hub'ında ve "zor bulunsun" diye oraya konmuştu (2026-08-05). Bunu
      // yazmazsak operatör kaydı kaybettiğini sanır (2026-08-25 saha sorusu:
      // "iptal ettim, top arşivinde göremedim").
      toast.success(`${ok} top ${verb}`, {
        description: "Kayıt silinmedi — Sistem → Top Arşivi'nde barkodla aranabilir.",
      });
    } else {
      toast.error(`${ok} başarılı, ${failed.length} başarısız`, {
        description: failed.slice(0, 3).join(" · ") + (failed.length > 3 ? " …" : ""),
        duration: 12_000,
      });
    }
    setProgress(null);
    onDone?.();
    onOpenChange(false);
  };

  const isScrap = mode === "SCRAP";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Stoktan Kaldır — {rolls.length} top
          </DialogTitle>
          <DialogDescription>
            Kayıt fiziksel olarak silinmez; stok listelerinden düşer ve denetim izi korunur.
          </DialogDescription>
        </DialogHeader>

        {/* ── KARAR: iptal mi, fire mi ─────────────────────────────────────── */}
        <div className="grid gap-2">
          {(
            [
              {
                v: "CANCEL" as Mode,
                icon: FileX2,
                title: "Kayıt hatası — hiç olmamalıydı",
                hint: "Yanlış giriş, mükerrer kayıt, yanlış metraj. Stok düşmez (mal zaten yoktu), fire sayılmaz.",
              },
              {
                v: "SCRAP" as Mode,
                icon: Flame,
                title: "Mal vardı, fire",
                hint: "Yandı, kirlendi, numune gitti. Stoktan gerçekten düşer ve fire raporuna girer.",
              },
            ] as const
          )
            .filter((o) => o.v !== "SCRAP" || canScrap)
            .map((o) => {
              const active = mode === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode(o.v);
                    setReasonCode(""); // katalog değişti — eski kod yeni listede yok
                  }}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors",
                    active
                      ? o.v === "SCRAP"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                        : "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <o.icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      active && o.v === "SCRAP"
                        ? "text-amber-600"
                        : active
                          ? "text-primary"
                          : "text-muted-foreground",
                    )}
                  />
                  <span>
                    <span className="block text-sm font-medium">{o.title}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </button>
              );
            })}
        </div>

        {/* Sebep varsayılan OPSİYONEL (2026-08-06 kuralı: zorunlu tutmak eldivenli operatörü rastgele kategori
            seçmeye itiyor); `production.cancelReasonRequired` AÇIKKEN sunucu önizlemesi zorunlu der, alan yıldızlanır. */}
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">
            {reasonRequired ? (
              <>
                Sebep <span className="text-destructive">*</span> (zorunlu — ayar: iptalde sebep zorunlu)
              </>
            ) : (
              "Sebep (isteğe bağlı)"
            )}
          </label>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={reasonCode}
            disabled={busy}
            onChange={(e) => setReasonCode(e.target.value)}
          >
            <option value="">— Seçilmedi</option>
            {reasonOptions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
          {previewsLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Toplar kontrol ediliyor…
            </div>
          )}
          {allowed.map(({ roll, preview }) => (
            <div key={roll.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="font-mono text-xs">{roll.barcode ?? "—"}</span>
              <span className="flex-1 truncate">{roll.item?.name ?? "—"}</span>
              {preview?.requiresConfirm && (
                /* Top bir istasyonda/iş emrinde AKTİF. Engel değil (pencere
                   onayı `confirmActive` ile veriyor) ama operatörün bilmesi
                   gereken somut etki: kaldırma o adımdan da çeker. */
                <span
                  className="flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400"
                  title={
                    preview.activeAt
                      ? `${preview.activeAt.stationName ?? "istasyon"} · ${preview.activeAt.batchNumber ?? ""}`
                      : undefined
                  }
                >
                  <Factory className="h-3 w-3" />
                  {preview.activeAt?.stationName ?? "istasyonda"}
                </span>
              )}
              {preview?.labelPrinted && (
                /* BİLGİ, engel değil: hangi kâğıdı depodan toplayacağını gösterir. */
                <span
                  className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"
                  title={
                    preview.labelPrintedAt
                      ? `Etiket ${safeFormat(preview.labelPrintedAt, "dd.MM.yyyy HH:mm")} tarihinde basıldı`
                      : undefined
                  }
                >
                  <Tag className="h-3 w-3" /> etiketli
                </span>
              )}
              <span className="tabular-nums text-muted-foreground">{DEC.format(roll.currentQty)} mt</span>
            </div>
          ))}
          {blocked.map(({ roll, preview }) => (
            <div key={roll.id} className="flex items-start gap-2 bg-muted/40 px-3 py-1.5">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground line-through">
                {roll.barcode ?? "—"}
              </span>
              {/* Backend'in KENDİ cümlesi — burada yeniden yazmak iki sözleşme demek. */}
              <span className="flex-1 text-xs text-muted-foreground">{preview?.blockReason}</span>
            </div>
          ))}
        </div>

        {labelled.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <strong>{labelled.length} topun etiketi basılmış.</strong> Kâğıtlar depoda topun üstünde olabilir
            — kaldırdıktan sonra sökülmesi iyi olur. İşlemi engellemez.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant={isScrap ? "default" : "destructive"}
            className={isScrap ? "bg-amber-600 text-white hover:bg-amber-700" : undefined}
            disabled={busy || previewsLoading || allowed.length === 0 || reasonMissing}
            onClick={() => void run()}
          >
            {busy
              ? `${progress?.done}/${progress?.total}…`
              : previewsLoading
                ? "Kontrol ediliyor…"
                : isScrap
                  ? `${allowed.length} topu fire et`
                  : `${allowed.length} topu stoktan kaldır`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
