// =============================================================================
// DÖNEM KAPATMA DİYALOĞU — önce FOTOĞRAF, sonra MÜHÜR
// =============================================================================
// Kapanış yıkıcı bir işlemdir: kapandıktan sonra o tarihe (ve öncesine) düşen
// her fatura/tahsilat/çek kaydı 409 alır. Kök kural gereği onay SOMUTTUR —
// "X kayıt etkilenecek" gibi soyut bir sayı yetmez. Bu yüzden ekran iki katman:
//
//   1. CANLI ÖNİZLEME (`/preview`, hiçbir şey yazmaz) — mühürlenecek bakiye,
//      hareket adedi, borç/alacak toplamı, kapsam sınırı, komşu kapanışlar.
//   2. ONAY DİYALOĞU — aynı rakamları cümle olarak tekrar eder ve sonucu söyler.
//
// ⚠️ ÖNİZLEME "ŞU ANKİ TAHMİN"DİR, rezervasyon değil. Kapanış anında backend
// kilit ALTINDA yeniden ölçer; arada bir kayıt girmişse mühürlenen rakam
// önizlemedekinden farklı olabilir. Bu yüzden başarı toast'ı backend'in
// kendi cümlesini basar — ekrandaki tahmini değil.
//
// ⚠️ HATA MESAJLARI YUTULMAZ. "Zaten kapalı", "daha ileri bir kapanış var",
// "gelecek dönem kapatılamaz" cümlelerini backend yol gösterici yazmıştır ve
// apiClient interceptor'ı onları olduğu gibi toast'lar. Bu yüzden `onError`
// YAZILMAZ (duplicate toast olur) ve mesaj yeniden yazılmaz.
// =============================================================================

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Info, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { Currency } from "../service";
import { CariPicker } from "./CariPicker";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import {
  PERIOD_CURRENCIES,
  closePeriod,
  formatDayKey,
  formatInstant,
  getPeriodPreview,
  lastDayOfPreviousMonth,
  lastDayOfPreviousYear,
  moneyOf,
  ymd,
} from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClosePeriodDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [cariId, setCariId] = useState<string | null>(null);
  const [cariLabel, setCariLabel] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [periodEnd, setPeriodEnd] = useState(ymd(lastDayOfPreviousMonth()));
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  const preview = useQuery({
    queryKey: ["finance", "period-preview", cariId, currency, periodEnd],
    queryFn: () => getPeriodPreview({ cariId: cariId as string, currency, periodEnd }),
    enabled: Boolean(cariId && periodEnd),
  });

  const p = preview.data;
  // ⚠️ GELECEK DÖNEM KAPATILAMAZ ve bu, sunucuya gitmeden söylenir. Backend
  // zaten 400 veriyor (tek sed odur); buradaki kontrol onun yerine geçmez,
  // sebebi kullanıcının GÖZÜ ÖNÜNDE yazar. Aksi halde önizlemede dolu dolu
  // rakam görüp butona basan kullanıcı, ancak toast'ta öğrenirdi.
  const todayYmd = ymd(new Date());
  const futurePeriod = Boolean(periodEnd) && periodEnd > todayYmd;
  // Aynı dönem zaten kapalıysa ya da daha ileri bir kapanış varsa buton
  // ÇİZİLİR ama kapalıdır: sebebi ekranda yazılı, "bastım bir şey olmadı"
  // yerine "neden basamıyorum" cevabı görünür.
  const blocked = Boolean(p?.blockingClose);
  // ⚠️ `p` ŞARTI LOAD-BEARING — kaldırma. Önizleme İSTEĞİ DÜŞERSE (sunucu
  // kapalı, 500, cari silinmiş) `isLoading` false'a döner ve `p` undefined
  // kalır; bu şart olmadan buton AÇIK olur, onay diyaloğu `description=""` ile
  // BOŞ açılır ve kullanıcı hangi rakamı mühürlediğini HİÇ görmeden mühürler.
  // Kök kural: yıkıcı işlemde onay somut olmalı — soyut sayı bile yetmezken
  // boş metin hiç yetmez. Yani iki katmanlı tasarım (önce fotoğraf, sonra
  // mühür) tam da hata anında tek katmana çökerdi.
  const canSubmit =
    Boolean(cariId && periodEnd && p) && !blocked && !futurePeriod && !preview.isLoading;

  const closeM = useMutation({
    mutationFn: () =>
      closePeriod({
        cariId: cariId as string,
        currency,
        periodEnd,
        notes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Dönem kapatıldı.");
      setConfirming(false);
      setNotes("");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const applyPreset = (d: Date) => setPeriodEnd(ymd(d));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dönem Kapat</DialogTitle>
            <DialogDescription>
              Kapanış deftere satır YAZMAZ — seçilen tarihteki bakiyenin fotoğrafını çeker ve o dönemi
              MÜHÜRLER. Mühürden sonra o tarihe ve öncesine kayıt girilemez.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Cari hesap</Label>
              <CariPicker
                className="mt-1 w-full"
                value={cariId}
                selectedLabel={cariLabel}
                onChange={(c) => {
                  setCariId(c?.id ?? null);
                  setCariLabel(c ? `${c.code} — ${c.name}` : null);
                  // Carinin kendi para birimiyle aç — bakılacak olan neredeyse
                  // her zaman odur; kullanıcı yine değiştirebilir.
                  if (c) setCurrency(c.defaultCurrency);
                }}
              />
            </div>

            <div>
              <Label>Para birimi</Label>
              {/* ⚠️ Kapanış (cari, PARA BİRİMİ) çiftine aittir. TRY'yi kapatmak
                  USD'yi kapatmaz — iki para birimini tek mühre indirmek
                  matematiksel olarak anlamsız olurdu. */}
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {PERIOD_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Dönem sonu (bu gün dahil)</Label>
              <DatePickerInput aria-label="Dönem sonu (bu gün dahil)" className="mt-1" max={todayYmd} value={periodEnd} onChange={setPeriodEnd} />
            </div>

            <div className="col-span-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Hızlı seçim:</span>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(lastDayOfPreviousMonth())}>
                Geçen ay sonu
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(lastDayOfPreviousYear())}>
                Geçen yıl sonu
              </Button>
            </div>

            <div className="col-span-2">
              <Label>Not (opsiyonel)</Label>
              <Textarea
                className="mt-1"
                rows={2}
                maxLength={500}
                placeholder="Örn. mutabakat imzalandı, beyanname verildi."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {futurePeriod && (
            <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Gelecek bir dönem kapatılamaz. Kapanış yalnız BİTMİŞ dönemler içindir — bugünü ya da daha
              eski bir tarih seçin.
            </p>
          )}

          {/* ── ÖNİZLEME ─────────────────────────────────────────────────── */}
          {!cariId ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Mühürlenecek rakamı görmek için önce cari seçin.
            </div>
          ) : preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Dönem ölçülüyor…</p>
          ) : !p ? (
            /* Sessiz `null` YASAK: buton yukarıdaki `p` şartı yüzünden kapalı
               kalır ve sebebi ekranda yazmazsa kullanıcı "bastım, bir şey
               olmadı" derdi. Kapalı butonun gerekçesi daima görünür. */
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Mühürlenecek rakam ölçülemedi.</p>
                <p className="mt-0.5 text-xs">
                  Önizleme alınamadığı için dönem kapatılamaz — ne mühürlediğinizi görmeden mühürlemek
                  yok. Tekrar deneyin.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void preview.refetch()}
                >
                  Tekrar dene
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Mühürlenecek bakiye</span>
                  <span className="font-semibold">{moneyOf(p.closingBalance, currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hareket adedi</span>
                  <span className="font-medium">{p.txnCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Toplam borç</span>
                  <span>{moneyOf(p.totalDebit, currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Toplam alacak</span>
                  <span>{moneyOf(p.totalCredit, currency)}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Kapsam: {formatDayKey(p.periodEnd)} günü dahil, o günün sonuna kadar (son an{" "}
                {formatInstant(p.cut)} öncesi). Bakiye pozitifse cari size borçludur.
              </p>

              {p.previousClose && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Önceki kapanış: {formatDayKey(p.previousClose.periodEnd)} —{" "}
                  {moneyOf(p.previousClose.closingBalance, currency)}
                </p>
              )}

              {p.blockingClose && (
                <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {p.alreadyClosed
                    ? `Bu dönem (${formatDayKey(p.periodEnd)} — ${currency}) ZATEN KAPALI. Yeniden kapatılamaz.`
                    : `Daha ileri bir kapanış var (${formatDayKey(p.blockingClose.periodEnd)}). ${formatDayKey(p.periodEnd)} zaten onun içinde kapalı sayılır — kapatacak bir şey yok.`}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button disabled={!canSubmit || closeM.isPending} onClick={() => setConfirming(true)}>
              <Lock className="mr-1 h-4 w-4" />
              Dönemi Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Onay, önizlemenin RAKAMLARINI cümleye çevirir: kullanıcı neyi
          mühürlediğini ve sonucunu okumadan geçemez. */}
      <ConfirmDialog
        /* İkinci emniyet kemeri: rakam yoksa onay EKRANI HİÇ AÇILMAZ. `canSubmit`
           zaten `p` istiyor, ama onay açıkken önizleme tazelenip düşerse tek
           şartlı kurgu boş metinli bir "mühürle" butonu bırakırdı. */
        open={confirming && Boolean(p)}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Dönemi mühürle"
        description={
          p
            ? `${cariLabel ?? "Cari"} — ${currency}\n` +
              `Dönem sonu: ${formatDayKey(p.periodEnd)} (bu gün dahil)\n` +
              `Mühürlenecek bakiye: ${moneyOf(p.closingBalance, currency)}\n` +
              `Hareket adedi: ${p.txnCount}  ·  Borç ${moneyOf(p.totalDebit, currency)}  ·  Alacak ${moneyOf(p.totalCredit, currency)}\n\n` +
              `Bu tarihe ve ÖNCESİNE düşen yeni fatura, tahsilat ve çek kaydı bundan sonra REDDEDİLİR. ` +
              `Geri almak için dönemi yeniden açmanız gerekir ve bu işlem iz bırakır.`
            : ""
        }
        confirmLabel="Kapat ve mühürle"
        isPending={closeM.isPending}
        onConfirm={() => closeM.mutate()}
      />
    </>
  );
}
