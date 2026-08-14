// CARİ EKSTRE
//
// ⚠️ Para birimi ZORUNLU seçilir ve varsayılan carinin KENDİ para birimidir.
// İki para birimini tek yürüyen bakiyede göstermek matematiksel olarak
// anlamsızdır; "hepsi" diye bir seçenek bilinçli olarak YOKTUR.
import { useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { OpeningBalanceDialog } from "./OpeningBalanceDialog";
import { findActiveDevirRowId } from "./statementDevir";
import {
  getStatement,
  cancelOpeningBalance,
  money,
  type CariRow,
  type Currency,
  type StatementRow,
} from "./service";

interface Props {
  cari: CariRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Yerel gün sınırı — backend mutlak an olarak alır (useReportDateRange sözleşmesi). */
function dayStart(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function dayEnd(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Devir iptali hatasını EKRANDA yazan tek yol. İstek `suppressErrorToast` ile
 * gider (bkz. `service.cancelOpeningBalance`), yani buradaki metin gösterilmezse
 * sebep tamamen KAYBOLUR. Sıra load-bearing: alan hataları → gövde mesajı →
 * yedek — sabit metinle başlamak backend'in söylediği somut cümleyi
 * ("zaten iptal edilmiş" / "dönem kapalı") ezerdi. 409/404 mesajları AYNEN basılır.
 */
function cancelErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? [])
      .map((e) => e?.message)
      .filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  }
  return "Devir iptali yapılamadı. Lütfen tekrar deneyin.";
}

export function StatementDialog({ cari, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const today = useMemo(() => new Date(), []);
  const monthAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d;
  }, []);

  // Bakiyesi olan bir para birimi varsa onunla aç — kullanıcının bakmak
  // istediği şey neredeyse her zaman odur.
  const [currency, setCurrency] = useState<Currency>(
    (cari.balances[0]?.currency ?? cari.defaultCurrency) as Currency,
  );
  const [from, setFrom] = useState(ymd(monthAgo));
  const [to, setTo] = useState(ymd(today));

  // Devir stornosu onayı — sebep ZORUNLU, etkilenen kayıt somut listelenir.
  const [cancelRow, setCancelRow] = useState<StatementRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Devir GİRİŞ formu — koşullu mount: kapanınca form durumu ölür (taşınmaz).
  const [openingFormOpen, setOpeningFormOpen] = useState(false);

  const q = useQuery({
    queryKey: ["finance", "statement", cari.id, currency, from, to],
    queryFn: () =>
      getStatement({
        cariId: cari.id,
        currency,
        from: dayStart(new Date(from)),
        to: dayEnd(new Date(to)),
      }),
  });

  // "Devri İptal Et" düğmesinin bağlanacağı satır — yüklem SAF KATMANDA
  // (`statementDevir.findActiveDevirRowId`, gerekçesi + bekçisi orada; ekran-içi
  // useMemo'da yaşasaydı tersine çevrilmesi hiçbir testi kırmazdı).
  const activeDevirRowId = useMemo(() => findActiveDevirRowId(q.data?.rows ?? []), [q.data]);

  const cancelM = useMutation({
    mutationFn: (input: { reason: string }) =>
      cancelOpeningBalance({ cariId: cari.id, currency, reason: input.reason }),
    onSuccess: (r) => {
      // Backend mesajı "doğru devri şimdi girebilirsiniz" bilgisini zaten
      // taşıyor — AYNEN gösterilir; yedek metin de aynı bilgiyi söyler.
      toast.success(
        r.message ?? "Devir iptal edildi — ters kayıt bugüne yazıldı; doğru devri şimdi girebilirsiniz.",
      );
      setCancelRow(null);
      setCancelReason("");
      setCancelError(null);
      // Bakiye değişti: cari listesi + ekstre birlikte tazelenir
      // (["finance"] öneki ikisini de kapsar — PaymentsPage deseni).
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) => setCancelError(cancelErrorText(e)),
  });

  const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

  // Devir satırı tek yönlüdür: borç YA DA alacak dolu. Ters kayıt bakiyeyi
  // tam bu tutar kadar diğer yöne çeker.
  const devirIsDebit = (cancelRow?.debit ?? 0) > 0;
  const devirAmount = devirIsDebit ? (cancelRow?.debit ?? 0) : (cancelRow?.credit ?? 0);
  const reasonTrimmed = cancelReason.trim();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{cari.name} — Cari Ekstre</DialogTitle>
            <DialogDescription>
              Dönem devri, hareketler ve yürüyen bakiye. Bakiye pozitifse cari size borçludur.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs">Para birimi</Label>
              <select
                className="mt-1 h-9 rounded-md border bg-background px-2 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Başlangıç</Label>
              <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Bitiş</Label>
              <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {/* Devir GİRİŞİ — stornonun ("Devri İptal Et") giriş ayağı, aynı
                izin kapısı. Aktif devir varken de ÇİZİLİR: gizlemek "neden
                yok" sorusunu cevapsız bırakırdı; backend 409'u formun kendi
                hata alanında yol göstererek söyler ("önce iptal edin"). */}
            <PermissionGate permission="finance:invoice">
              <div className="ml-auto">
                <Button variant="outline" onClick={() => setOpeningFormOpen(true)}>
                  Devir Gir
                </Button>
              </div>
            </PermissionGate>
          </div>

          {q.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : !q.data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Kayıt bulunamadı.</p>
          ) : (
            <div className="max-h-[52vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left">Tarih</th>
                    <th className="px-3 py-2 text-left">Belge</th>
                    <th className="px-3 py-2 text-left">Açıklama</th>
                    <th className="px-3 py-2 text-right">Borç</th>
                    <th className="px-3 py-2 text-right">Alacak</th>
                    <th className="px-3 py-2 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {/* DÖNEM DEVRİ: dönem başından ÖNCEKİ tüm hareketlerin toplamı.
                      Olmadan "kapanış bakiyesi" — ekstrenin en çok bakılan sayısı —
                      yanlış çıkar. */}
                  <tr className="border-t bg-muted/30 font-medium">
                    <td className="px-3 py-2" colSpan={5}>
                      Dönem devri
                    </td>
                    <td className="px-3 py-2 text-right">{money(q.data.opening, currency)}</td>
                  </tr>
                  {q.data.rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(r.txnDate).toLocaleDateString("tr-TR")}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.docNo ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.id === activeDevirRowId ? (
                          <span className="flex items-center justify-between gap-2">
                            <span>{r.description ?? "—"}</span>
                            {/* İzin `finance:invoice` — deftere işleyen her şeyle
                                aynı kapı (backend ile birebir). */}
                            <PermissionGate permission="finance:invoice">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 shrink-0 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => {
                                  setCancelRow(r);
                                  setCancelReason("");
                                  setCancelError(null);
                                }}
                              >
                                Devri İptal Et
                              </Button>
                            </PermissionGate>
                          </span>
                        ) : (
                          (r.description ?? "—")
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{r.debit ? money(r.debit, currency) : ""}</td>
                      <td className="px-3 py-2 text-right">{r.credit ? money(r.credit, currency) : ""}</td>
                      <td className="px-3 py-2 text-right font-medium">{money(r.running, currency)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="px-3 py-2" colSpan={3}>
                      Dönem toplamı
                    </td>
                    <td className="px-3 py-2 text-right">{money(q.data.totalDebit, currency)}</td>
                    <td className="px-3 py-2 text-right">{money(q.data.totalCredit, currency)}</td>
                    <td className="px-3 py-2 text-right">{money(q.data.closing, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DEVİR GİRİŞİ — koşullu mount (form durumu kapanınca ölür). */}
      {openingFormOpen && (
        <OpeningBalanceDialog
          cari={cari}
          initialCurrency={currency}
          open={openingFormOpen}
          onOpenChange={setOpeningFormOpen}
        />
      )}

      {/* DEVİR STORNOSU ONAYI — yıkıcı-işlem sözleşmesi: etkilenen kayıt SOMUT
          listelenir (tutar, para birimi, tarih, bakiye etkisi); sebep ZORUNLU.
          Hata (404/409 dahil) bu diyalogda AYNEN gösterilir — istek toast'ı
          bastırır, buradaki metin tek yüzeydir. */}
      {cancelRow && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o && !cancelM.isPending) {
              setCancelRow(null);
              setCancelError(null);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Devri İptal Et</DialogTitle>
              <DialogDescription>
                Kayıt silinmez — bugünün tarihiyle "Devir iptali" TERS kaydı yazılır ve
                ekstrede iki satır da görünmeye devam eder. İptalden sonra doğru devri
                yeniden girebilirsiniz.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Cari</span>
                <span className="text-right font-medium">{cari.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Devir tarihi</span>
                <span>{new Date(cancelRow.txnDate).toLocaleDateString("tr-TR")}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Tutar</span>
                <span className="font-medium">
                  {money(devirAmount, currency)} ({devirIsDebit ? "Borç" : "Alacak"})
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Açıklama</span>
                <span className="text-right">{cancelRow.description ?? "—"}</span>
              </div>
              <div className="mt-2 border-t pt-2 font-medium text-destructive">
                {/* Ters kayıt tutarı orijinalden AYNEN kopyalanır (kur dahil) —
                    bakiye tam bu kadar değişir. */}
                Cari bakiyesi {money(devirAmount, currency)} {devirIsDebit ? "azalacak" : "artacak"}.
              </div>
            </div>

            <div>
              <Label className="text-xs">İptal gerekçesi (zorunlu, en az 3 karakter)</Label>
              <Textarea
                className="mt-1"
                rows={2}
                autoFocus
                placeholder="Örn. tutar yanlış girildi — 4.250 yerine 42.500 yazılmış"
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value);
                  if (cancelError) setCancelError(null);
                }}
              />
              {reasonTrimmed.length > 0 && reasonTrimmed.length < 3 && (
                <p className="mt-1 text-xs text-destructive">Gerekçe en az 3 karakter olmalı.</p>
              )}
            </div>

            {cancelError && (
              <p className="whitespace-pre-line text-sm font-medium text-destructive">{cancelError}</p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                disabled={cancelM.isPending}
                onClick={() => {
                  setCancelRow(null);
                  setCancelError(null);
                }}
              >
                Vazgeç
              </Button>
              <Button
                variant="destructive"
                disabled={cancelM.isPending || reasonTrimmed.length < 3}
                onClick={() => cancelM.mutate({ reason: reasonTrimmed })}
              >
                {cancelM.isPending ? "İptal ediliyor…" : "Devri İptal Et"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
