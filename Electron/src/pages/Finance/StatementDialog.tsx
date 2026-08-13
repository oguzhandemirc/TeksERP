// CARİ EKSTRE
//
// ⚠️ Para birimi ZORUNLU seçilir ve varsayılan carinin KENDİ para birimidir.
// İki para birimini tek yürüyen bakiyede göstermek matematiksel olarak
// anlamsızdır; "hepsi" diye bir seçenek bilinçli olarak YOKTUR.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getStatement, money, type CariRow, type Currency } from "./service";

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

export function StatementDialog({ cari, open, onOpenChange }: Props) {
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

  const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

  return (
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
                    <td className="px-3 py-2 text-muted-foreground">{r.description ?? "—"}</td>
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
  );
}
