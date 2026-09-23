import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe2, Home, Plane, Truck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import {
  amountText,
  buildDestinationMixExport,
  destinationMixApi,
  kgText,
  tlText,
  totalCoverage,
  type MixBucketSummary,
} from "./destinationMix";
import { countryColumns, customerColumns, itemColumns } from "./destinationMixColumns";
import { DestinationMixCoverage, DestinationMixOrdersTab } from "./DestinationMixParts";

const ICON = { DOMESTIC: Home, EXPORT: Plane, NONE: Truck } as const;

function bucketHint(b: MixBucketSummary, prev: MixBucketSummary | undefined): string {
  const parts = [`${fmtInt(b.shipmentCount)} sevk`, kgText(b), `iade ${fmtNum(b.returnQty)} m (düşülmedi)`, amountText(b.money)];
  if (b.money.pricedLineCount > 0) parts.push(tlText(b.money));
  if (prev) parts.push(`önceki dönem ${fmtNum(prev.meters)} m`);
  return parts.join(" · ");
}

/**
 * Yurtiçi / Yurtdışı Satış — ilk ekranda yalnız yön kartları (+ karşılaştırma) ve kapsam;
 * kırılımlar sekmelerde. Her sayının kaynağı/kapsamı kartın altında yazar.
 */
export function DestinationMixPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/destination-mix");
  const compare = useReportCompare();
  const query = useQuery({
    queryKey: ["reports", "sales", "destination-mix", params, compare.params],
    queryFn: () => destinationMixApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });
  const r = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;
  const spec = useMemo(() => () => (r ? buildDestinationMixExport({ r, periodLabel, compareLabel }) : null), [r, periodLabel, compareLabel]);
  const cov = r ? totalCoverage(r.buckets) : null;

  return (
    <ReportPageLayout
      reportKey="sales/destination-mix"
      title="Yurtiçi / Yurtdışı Satış"
      description="Sevkiyatın sevk anındaki yönüne göre dağılım; ihracat müşteri, ülke ve ürün kırılımı; açık sipariş ve termin."
      showCompare
      actions={<ReportExportBar disabled={!r} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {(r?.buckets ?? []).map((b) => (
          <MetricCard
            key={b.bucket}
            label={b.label}
            value={`${fmtNum(b.meters)} m`}
            hint={bucketHint(b, r?.prevBuckets?.find((p) => p.bucket === b.bucket))}
            icon={ICON[b.bucket]}
            tone={b.bucket === "NONE" && b.meters > 0 ? "warn" : "neutral"}
            isLoading={query.isLoading}
          />
        ))}
        {!r && query.isLoading ? <MetricCard label="Yükleniyor" value="" isLoading /> : null}
      </div>

      {r && cov ? <DestinationMixCoverage r={r} priced={cov.priced} lines={cov.lines} /> : null}

      {r ? (
        <Tabs defaultValue="customer">
          <TabsList>
            <TabsTrigger value="customer">Müşteri</TabsTrigger>
            <TabsTrigger value="country"><Globe2 className="mr-1 h-3.5 w-3.5" />Ülke</TabsTrigger>
            <TabsTrigger value="item">Ürün</TabsTrigger>
            <TabsTrigger value="orders">Açık sipariş ve termin</TabsTrigger>
          </TabsList>
          <TabsContent value="customer">
            <DetailTable data={r.byCustomer} columns={customerColumns} isLoading={query.isLoading} emptyLabel="Bu dönemde sevkiyat yok" />
          </TabsContent>
          <TabsContent value="country">
            <DetailTable data={r.byCountry} columns={countryColumns} isLoading={query.isLoading} emptyLabel="Bu dönemde sevkiyat yok" />
          </TabsContent>
          <TabsContent value="item">
            <DetailTable data={r.byItem} columns={itemColumns} isLoading={query.isLoading} emptyLabel="Bu dönemde sevkiyat yok" />
          </TabsContent>
          <TabsContent value="orders" className="space-y-3">
            <DestinationMixOrdersTab r={r} isLoading={query.isLoading} />
          </TabsContent>
        </Tabs>
      ) : null}
    </ReportPageLayout>
  );
}
