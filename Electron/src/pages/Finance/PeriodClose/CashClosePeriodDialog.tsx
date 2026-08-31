// =============================================================================
// KASA/BANKA DÖNEM KAPATMA DİYALOĞU — önce FOTOĞRAF, sonra MÜHÜR (K-1)
// =============================================================================
// `ClosePeriodDialog`'un HESAP-bazlı ikizi. GÖVDE PARAMETRİZE EDİLMEDİ, ayrı
// dosya yazıldı — bilinçli: iki formun ortak kısmı yalnız iskelet (tarih +
// not + onay akışı); ASIL içerik olan kapsam seçimi (cari×para ↔ hesap) ve
// önizleme alanları (borç/alacak ↔ giren/çıkan) zaten farklı. Ortaklaştırma
// burada "iki formun her alanı prop olan üçüncü bir form" üretirdi (Verify/
// Reopen/LockStatus'ta tersi doğruydu: orada gövde aynı, yalnız kimlik bloğu
// farklıydı — onlar Base'e alındı).
//
// İki katman ClosePeriodDialog ile aynı ve aynı gerekçeyle:
//   1. CANLI ÖNİZLEME (`/preview`, hiçbir şey yazmaz) — mühürlenecek bakiye,
//      hareket adedi, giren/çıkan toplamı, kapsam sınırı, komşu kapanışlar.
//   2. ONAY DİYALOĞU — aynı rakamları cümle olarak tekrar eder.
//
// ⚠️ PARA BİRİMİ SEÇİCİSİ YOK ve eklenmemeli: kapanışın ekseni HESAPTIR, hesap
// tek para birimlidir (şema kararı — cashService dosya başı). Birim, seçilen
// hesabın kendisinden okunur ve yalnız gösterimde kullanılır.
//
// ⚠️ ÖNİZLEME "ŞU ANKİ TAHMİN"DİR; kapanış anında backend kilit ALTINDA
// yeniden ölçer. Başarı toast'ı backend cümlesini basar. Hata mesajları
// YUTULMAZ (interceptor aynen toast'lar; `onError` yazılmaz — duplicate olur).
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { CashAccountPicker, cashAccountLabel, type CashAccountOption } from "./CashAccountPicker";
import { closeCashPeriod, fmtCashMoney, getCashPeriodPreview, CASH_KIND_LABEL } from "./cashService";
import { formatDayKey, formatInstant, lastDayOfPreviousMonth, lastDayOfPreviousYear, ymd } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CashClosePeriodDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [account, setAccount] = useState<CashAccountOption | null>(null);
  const [periodEnd, setPeriodEnd] = useState(ymd(lastDayOfPreviousMonth()));
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  const preview = useQuery({
    queryKey: ["finance", "cash-period-preview", account?.kind, account?.id, periodEnd],
    queryFn: () =>
      getCashPeriodPreview({
        kind: (account as CashAccountOption).kind,
        id: (account as CashAccountOption).id,
        periodEnd,
      }),
    enabled: Boolean(account && periodEnd),
  });

  const p = preview.data;
  const fmt = (v: Parameters<typeof fmtCashMoney>[0]) => fmtCashMoney(v, account?.currency ?? null);

  // Gelecek dönem sunucuya gitmeden reddedilir — backend 400'ü tek seddir,
  // buradaki kontrol sebebi kullanıcının GÖZÜ ÖNÜNDE yazar (cari emsali).
  const todayYmd = ymd(new Date());
  const futurePeriod = Boolean(periodEnd) && periodEnd > todayYmd;
  const blocked = Boolean(p?.blockingClose);
  // ⚠️ `p` ŞARTI LOAD-BEARING (cari diyalogdaki notun aynısı): önizleme isteği
  // düşerse buton kapalı kalmalı — ne mühürlediğini görmeden mühürlemek yok.
  const canSubmit = Boolean(account && periodEnd && p) && !blocked && !futurePeriod && !preview.isLoading;

  const closeM = useMutation({
    mutationFn: () =>
      closeCashPeriod({
        kind: (account as CashAccountOption).kind,
        id: (account as CashAccountOption).id,
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
            <DialogTitle>Kasa/Banka Dönemi Kapat</DialogTitle>
            <DialogDescription>
              Kapanış deftere satır YAZMAZ — hesabın seçilen tarihteki bakiyesinin fotoğrafını çeker ve o
              dönemi MÜHÜRLER. Mühürden sonra o tarihe ve öncesine tahsilat/ödeme, kasa hareketi ve çek
              tahsilatı girilemez.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Hesap (kasa ya da banka)</Label>
              {/* Para birimi SORULMAZ — hesabın kendisinden gelir (dosya başı). */}
              <CashAccountPicker className="mt-1 w-full" value={account} onChange={setAccount} />
            </div>

            <div>
              <Label>Dönem sonu (bu gün dahil)</Label>
              <Input
                type="date"
                className="mt-1"
                max={todayYmd}
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="text-xs text-muted-foreground">Hızlı seçim:</span>
                <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(lastDayOfPreviousMonth())}>
                  Geçen ay sonu
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(lastDayOfPreviousYear())}>
                  Geçen yıl sonu
                </Button>
              </div>
            </div>

            <div className="col-span-2">
              <Label>Not (opsiyonel)</Label>
              <Textarea
                className="mt-1"
                rows={2}
                maxLength={500}
                placeholder="Örn. kasa sayımı yapıldı, tutanak imzalandı."
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
          {!account ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Mühürlenecek rakamı görmek için önce hesap seçin.
            </div>
          ) : preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Dönem ölçülüyor…</p>
          ) : !p ? (
            /* Sessiz `null` YASAK: kapalı butonun gerekçesi daima görünür. */
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Mühürlenecek rakam ölçülemedi.</p>
                <p className="mt-0.5 text-xs">
                  Önizleme alınamadığı için dönem kapatılamaz — ne mühürlediğinizi görmeden mühürlemek
                  yok. Tekrar deneyin.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void preview.refetch()}>
                  Tekrar dene
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Mühürlenecek bakiye</span>
                  <span className="font-semibold">{fmt(p.closingBalance)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hareket adedi</span>
                  <span className="font-medium">{p.txnCount}</span>
                </div>
                {/* Kasa defteri borç/alacak değil GİREN/ÇIKAN konuşur — üç
                    yazarın (tahsilat/ödeme · kasa hareketi · çek tahsilatı)
                    ortak dili budur. */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Toplam giren</span>
                  <span>{fmt(p.totalIn)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Toplam çıkan</span>
                  <span>{fmt(p.totalOut)}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Kapsam: {formatDayKey(p.periodEnd)} günü dahil, o günün sonuna kadar (son an{" "}
                {formatInstant(p.cut)} öncesi). Hareket adedi tahsilat/ödeme + kasa hareketi + çek
                tahsilatlarının toplamıdır.
              </p>

              {p.previousClose && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Önceki kapanış: {formatDayKey(p.previousClose.periodEnd)} — {fmt(p.previousClose.closingBalance)}
                </p>
              )}

              {p.blockingClose && (
                <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {p.alreadyClosed
                    ? `Bu dönem (${formatDayKey(p.periodEnd)}) bu hesap için ZATEN KAPALI. Yeniden kapatılamaz.`
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

      {/* Onay, önizlemenin RAKAMLARINI cümleye çevirir (cari emsali). */}
      <ConfirmDialog
        /* İkinci emniyet kemeri: rakam yoksa onay ekranı HİÇ açılmaz. */
        open={confirming && Boolean(p)}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Dönemi mühürle"
        description={
          p && account
            ? `${cashAccountLabel(account)} (${CASH_KIND_LABEL[account.kind]})\n` +
              `Dönem sonu: ${formatDayKey(p.periodEnd)} (bu gün dahil)\n` +
              `Mühürlenecek bakiye: ${fmt(p.closingBalance)}\n` +
              `Hareket adedi: ${p.txnCount}  ·  Giren ${fmt(p.totalIn)}  ·  Çıkan ${fmt(p.totalOut)}\n\n` +
              `Bu tarihe ve ÖNCESİNE düşen yeni tahsilat/ödeme, kasa hareketi ve çek tahsilatı bundan ` +
              `sonra REDDEDİLİR; kapalı dönemdeki bir kaydın iptali de dönemi yeniden açmadan yapılamaz. ` +
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
