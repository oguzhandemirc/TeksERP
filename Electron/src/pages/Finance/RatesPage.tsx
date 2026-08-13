import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/PermissionGate";
import { listRates, createRate, type Currency } from "./service";

// TL kur tablosuna GİRMEZ: kendi para birimimizin kendine kuru 1'dir ve backend
// bunu koda gömer. Listede göstermek "girmeyi unuttum mu" sorusu doğururdu.
const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "RUB"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RatesPage() {
  const qc = useQueryClient();
  const [rateDate, setRateDate] = useState(ymd(new Date()));
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rate, setRate] = useState(0);

  const q = useQuery({ queryKey: ["finance", "rates"], queryFn: listRates });

  const createM = useMutation({
    mutationFn: () => createRate({ rateDate, currency, rate }),
    onSuccess: () => {
      toast.success("Kur kaydedildi.");
      setRate(0);
      void qc.invalidateQueries({ queryKey: ["finance", "rates"] });
    },
  });

  const rows = q.data?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Kurlar"
        description="1 birim döviz kaç TL. Fatura ve tahsilatlar belge tarihine en yakın (≤) kuru kullanır ve o kuru belgeye DAMGALAR — sonradan kuru düzeltmek geçmiş belgeleri değiştirmez."
      />

      <PageBody className="space-y-6 p-6">
        <PermissionGate permission="finance:write">
          <div className="flex items-end gap-3 rounded-md border bg-muted/30 p-4">
            <div>
              <Label className="text-xs">Tarih</Label>
              <Input type="date" className="mt-1" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
            </div>
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
              <Label className="text-xs">Kur (TL)</Label>
              <Input
                type="number" min={0} step="0.000001"
                className="mt-1 w-36"
                value={rate || ""}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </div>
            <Button disabled={rate <= 0 || createM.isPending} onClick={() => createM.mutate()}>
              <Plus className="mr-1 h-4 w-4" />
              {createM.isPending ? "Kaydediliyor…" : "Kur ekle"}
            </Button>
          </div>
        </PermissionGate>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Kur girilmemiş. Döviz cinsinden fatura kesmek için önce o güne ait kuru girin.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Para Birimi</th>
                  <th className="px-3 py-2 text-right">Kur (TL)</th>
                  <th className="px-3 py-2 text-left">Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(r.rateDate).toLocaleDateString("tr-TR")}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.currency}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.rate).toFixed(4)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.source === "MANUAL" ? "Elle girildi" : "TCMB"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
