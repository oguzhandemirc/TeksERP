import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { PermissionGate } from "@/components/PermissionGate";
import { listRates, createRate, fetchTcmbRates, type Currency, type RateRow } from "./service";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { factoryDayKey, fmtDayKey } from "@/lib/factory-time";
import { formatAmount, safeFormatCalendar } from "@/lib/format";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

// TL kur tablosuna GİRMEZ: kendi para birimimizin kendine kuru 1'dir ve backend
// bunu koda gömer. Listede göstermek "girmeyi unuttum mu" sorusu doğururdu.
const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "RUB"];
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }));

const rateColumns: ColumnDef<RateRow>[] = [
  {
    id: "rateDate",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (r) => safeFormatCalendar(r.rateDate, "dd.MM.yyyy") },
    cell: ({ row }) => safeFormatCalendar(row.original.rateDate, "dd.MM.yyyy"),
  },
  { accessorKey: "currency", header: "Para Birimi", cell: ({ row }) => <span className="font-medium">{row.original.currency}</span> },
  {
    id: "rate",
    header: "Kur (TL)",
    // Kur para sınıfıdır (binlik ayraçlı, 4 hane) — `lib/format` tek biçimleyici; çıplak toFixed nokta basıyordu.
    meta: { label: "Kur (TL)", align: "right", exportValue: (r) => formatAmount(r.rate, 4) },
    cell: ({ row }) => <span className="tabular-nums">{formatAmount(row.original.rate, 4)}</span>,
  },
  {
    id: "source",
    header: "Kaynak",
    meta: { label: "Kaynak", exportValue: (r) => (r.source === "MANUAL" ? "Elle girildi" : "TCMB") },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.source === "MANUAL" ? "Elle girildi" : "TCMB"}</span>,
  },
];

function ymd(d: Date): string {
  return factoryDayKey(d);
}

export function RatesPage() {
  const qc = useQueryClient();
  const [rateDate, setRateDate] = useState(ymd(new Date()));
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rate, setRate] = useState(0);

  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["finance", "rates", term ?? ""], queryFn: () => listRates(term) });

  const createM = useMutation({
    mutationFn: () => createRate({ rateDate, currency, rate }),
    onSuccess: () => {
      toast.success("Kur kaydedildi.");
      setRate(0);
      void qc.invalidateQueries({ queryKey: ["finance", "rates"] });
    },
  });

  // Hata toast'ı apiClient interceptor'undan gelir (onError eklenmez — duplicate olur).
  const tcmbM = useMutation({
    mutationFn: fetchTcmbRates,
    onSuccess: (s) => {
      const date = fmtDayKey(s.fetched, s.fetched);
      const parts: string[] = [];
      if (s.written.length > 0) parts.push(`${s.written.length} kur yazıldı`);
      if (s.unchanged.length > 0) parts.push(`${s.unchanged.length} kur zaten günceldi`);
      if (s.skippedManual.length > 0)
        parts.push(`elle girilmiş ${s.skippedManual.map((x) => x.currency).join(", ")} korundu`);
      if (s.missing.length > 0) parts.push(`bültende bulunamayan: ${s.missing.join(", ")}`);
      toast.success(`TCMB ${date} bülteni: ${parts.join(" · ")}`);
      void qc.invalidateQueries({ queryKey: ["finance", "rates"] });
    },
  });

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = useLocalTable({ tableKey: "finance:rates", data: rows, columns: rateColumns });

  return (
    <PageShell>
      <PageHeader
        title="Kurlar"
        actions={<RefreshButton queryKey={["finance", "rates"]} />}
        description="1 birim döviz kaç TL. Fatura ve tahsilatlar belge tarihine en yakın (≤) kuru kullanır ve o kuru belgeye DAMGALAR — sonradan kuru düzeltmek geçmiş belgeleri değiştirmez."
      />

      {/* Kur giriş satırı + sağda liste araçları — tek satır, ortak kutu boyu (UI D2-f). */}
      <ListToolbar>
        <div className="flex flex-wrap items-center gap-2">
        <PermissionGate permission="finance:write">
          <div className="flex flex-wrap items-center gap-2">
            <DatePickerInput aria-label="Kur tarihi" title="Kur tarihi" className="h-8 w-40" value={rateDate} onChange={setRateDate} />
            <SelectChip<Currency> id="rate-currency" label="Para birimi" value={currency} options={CURRENCY_OPTIONS} resetValue="USD" onChange={(v) => setCurrency(v ?? "USD")} />
            <Input
              type="number" min={0} step="0.000001"
              aria-label="Kur (TL)" placeholder="Kur (TL)"
              className="h-8 w-32 text-sm"
              value={rate || ""}
              onChange={(e) => setRate(Number(e.target.value))}
            />
            <Button size="sm" disabled={rate <= 0 || createM.isPending} onClick={() => createM.mutate()}>
              <Plus className="mr-1 h-4 w-4" />
              {createM.isPending ? "Kaydediliyor…" : "Kur ekle"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={tcmbM.isPending}
              onClick={() => tcmbM.mutate()}
              title="TCMB döviz alış (ForexBuying) kurlarını bülten tarihine yazar. Elle girilmiş kurlar korunur."
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${tcmbM.isPending ? "animate-spin" : ""}`} />
              {tcmbM.isPending ? "Çekiliyor…" : "TCMB'den Çek"}
            </Button>
          </div>
        </PermissionGate>
          <div className="ml-auto flex items-center gap-1.5">
            <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Para birimi (USD, Dolar) ya da kaynak (TCMB, elle) ara" />
            <DataTableTools table={table} compact exportName="Kurlar" />
          </div>
        </div>
      </ListToolbar>

      {/* ⚠️ YANLIŞ BOŞ-DURUM METNİ EYLEME YÖNLENDİRİR ("önce kuru girin"): hata anında basılırsa mükerrer kur girilir
          (DataTable hata dalı boşun önünde). Aramada boş sonuç da "kur girilmemiş" DEĞİLDİR. */}
      <DataTable
        table={table}
        exportName="Kurlar"
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Kur listesi yüklenemedi — “kur girilmemiş” anlamına gelmez; yeni kur girmeden önce tekrar deneyin."
        emptyText={term ? "Aramaya uyan kur yok." : "Kur girilmemiş."}
        emptyDescription={term ? undefined : "Döviz cinsinden fatura kesmek için önce o güne ait kuru girin."}
      />
      <ListFooter loaded={rows.length} />
    </PageShell>
  );
}
