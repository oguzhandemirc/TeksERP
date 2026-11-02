import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FINANCE_CURRENCIES as CURRENCIES } from "@/pages/Customers/customerFinance";
import type { Currency } from "@/pages/Finance/service";
import { KURSUN_GRAMAJ_CATALOG_KEY } from "@/lib/kursun-gramaj";
import { KursunGramajTable } from "./KursunGramajTable";
import {
  buildKursunBody, fetchKursunStation, kursunStationKey, saveKursunStation, stateFromDto,
  type KursunStationState,
} from "./kursun-station";

/**
 * İstasyon formunda "Kurşun uygular" + gramaj tablosu (gr/m) + gram fiyatı (oie-a). Kendi kaydı vardır
 * (istasyon CRUD'una karışmaz); tüm düğmeler `type="button"` — dış form gönderilmez.
 */
export function StationKursunSection({ stationId }: { stationId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: kursunStationKey(stationId), queryFn: () => fetchKursunStation(stationId) });
  const [s, setS] = useState<KursunStationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (q.data) setS(stateFromDto(q.data)); }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof saveKursunStation>[1]) => saveKursunStation(stationId, body),
    onSuccess: (d) => {
      qc.setQueryData(kursunStationKey(stationId), d);
      void qc.invalidateQueries({ queryKey: KURSUN_GRAMAJ_CATALOG_KEY });
      void qc.invalidateQueries({ queryKey: ["station-capabilities"] });
      toast.success("Kurşun ayarı kaydedildi");
    },
  });

  if (!s) return null;
  if (q.data && q.data.flagPropertyId === null) {
    return <p className="text-xs text-muted-foreground">Katalogda &quot;Kurşun&quot; özelliği yok — kurşun ayarı için önce Özellikler ekranında tanımlayın.</p>;
  }
  const submit = () => {
    const r = buildKursunBody(s);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    save.mutate(r.body);
  };

  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="station-kursun-section">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} aria-label="Kurşun uygular" data-testid="kursun-enabled" />
        Kurşun uygular
      </label>
      {s.enabled && <KursunGramajTable rows={s.rows} onChange={(rows) => setS({ ...s, rows })} />}
      <div className="flex items-center gap-2">
        <span className="text-xs">Gram fiyatı (1 gr/m başına metre fiyatı)</span>
        <Input className="w-28" inputMode="decimal" placeholder="Yok" value={s.gramPrice} onChange={(e) => setS({ ...s, gramPrice: e.target.value })} aria-label="Gram fiyatı" />
        <select aria-label="Gram fiyatı para birimi" className="h-9 rounded-md border bg-background px-2 text-sm" value={s.gramCurrency} onChange={(e) => setS({ ...s, gramCurrency: e.target.value as Currency })}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Boşsa fatura hizmet kalemi fiyatıyla kesilir. Müşteri kartındaki gram fiyatı bunu ezer.</p>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      <Button type="button" size="sm" onClick={submit} disabled={save.isPending} data-testid="kursun-save">Kurşun ayarını kaydet</Button>
    </section>
  );
}
