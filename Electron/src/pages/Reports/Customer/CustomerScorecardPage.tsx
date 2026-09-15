import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Crown, Layers, Repeat, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import {
  buildCustomerScorecardExport,
  customerScorecardApi,
  type AbcClass,
  type AtRiskCustomerRow,
  type CustomerRankRow,
} from "./customerScorecard";

const ABC_TONE: Record<AbcClass, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  B: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  C: "bg-muted text-muted-foreground",
};

/**
 * SIRALAMA EKSENLERİ — "en çok veren" ile "en sık veren" AYNI SORU DEĞİL, ve
 * "en sık"ın kendisi de tek bir sayıya inmiyor (fabrikada bazı siparişler kalem
 * kalem, bazıları tek tek giriliyor). Tek bir sabit sıralama dayatmak, kullanıcının
 * sorusunu bizim seçtiğimiz ölçüye zorlamak olurdu; bu yüzden ekseni O seçiyor.
 *
 * ⚠️ SIRALAMA YALNIZ GÖRÜNÜMÜ değiştirir. ABC sınıfı ve kümülatif pay SUNUCUDA,
 * her zaman METRAJ sırasına göre hesaplanır ve satırın kendi özelliğidir —
 * başka bir eksene geçince o sütun artık artan görünmez ama her satırdaki değer
 * doğru kalır. (Pareto'yu sipariş adedine göre kurmak, tam da bu raporun
 * düzeltmeye çalıştığı hatayı sistemin içine gömerdi.)
 */
const SORT_AXES = [
  { key: "totalQty", label: "Metraj", hint: "En çok metre sipariş veren — giriş alışkanlığından bağımsız." },
  { key: "orderCount", label: "Sipariş", hint: "Kaç sipariş BELGESİ. Tek tek giren müşteriyi yukarı taşır — tek başına okumayın." },
  { key: "lineCount", label: "Kalem", hint: "Kaç ayrı mal istedi. Belge sayısından bağımsız." },
  { key: "orderDayCount", label: "Sipariş günü", hint: "Kaç ayrı gün sipariş verdi — sıklığın en dürüst ölçüsü." },
  { key: "avgOrderQty", label: "Ort. sipariş", hint: "Sipariş başına metraj — büyük mü sık mı alıyor." },
  { key: "cancelRatePct", label: "İptal %", hint: "Verdiği işin ne kadarını geri çekti." },
] as const;

type SortAxis = (typeof SORT_AXES)[number]["key"];

const rankColumns: ColumnDef<CustomerRankRow, unknown>[] = [
  {
    accessorKey: "abcClass",
    header: "Sınıf",
    cell: ({ getValue }) => {
      const c = getValue() as AbcClass;
      return (
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${ABC_TONE[c]}`}>{c}</span>
      );
    },
  },
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "orderCount",
    header: () => <div className="text-right">Sipariş</div>,
    // Belge adedi + hemen altında KALEM adedi. İkisi yan yana durmazsa
    // "3 sipariş" satırı, o üç siparişin 3 mü 30 kalem mi taşıdığını gizler —
    // kullanıcının bildirdiği yanılgı tam burada doğuyordu.
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtInt(row.original.orderCount)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          / {fmtInt(row.original.lineCount)} kalem
        </span>
      </div>
    ),
  },
  {
    accessorKey: "avgLinesPerOrder",
    header: () => <div className="text-right">Kalem/sipariş</div>,
    // Sıralama ölçütü DEĞİL, okuma anahtarı: ~1 → tek tek giriyor,
    // yüksek → kalem kalem. Rozet, sayının ne anlama geldiğini kelimeye çevirir;
    // çıplak "2.5" tek başına hiçbir şey söylemiyordu.
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const style = v >= 2 ? "text-sky-700 dark:text-sky-400" : "text-muted-foreground";
      return (
        <div className="text-right tabular-nums">
          {fmtNum(v)}
          <span className={`ml-1 text-[10px] ${style}`}>
            {v >= 2 ? "kalem kalem" : "tek tek"}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "orderDayCount",
    header: () => <div className="text-right">Sipariş günü</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtInt(getValue() as number)} gün</div>
    ),
  },
  {
    accessorKey: "totalQty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "avgOrderQty",
    header: () => <div className="text-right">Ort. sipariş</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "cumulativePct",
    header: () => <div className="text-right">Kümülatif</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtPercent(row.original.cumulativePct)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          (pay {fmtPercent(row.original.sharePct)})
        </span>
      </div>
    ),
  },
  {
    accessorKey: "avgIntervalDays",
    header: () => <div className="text-right">Sıklık</div>,
    // "Sıklık" = ortalama kaç günde bir sipariş. TÜM GEÇMİŞTEN gelir; hesaplanamıyorsa
    // sayı UYDURULMAZ, sebebi yazılır (2 siparişten ritim çıkarmak tek gözlemdir).
    cell: ({ row }) => {
      const v = row.original.avgIntervalDays;
      if (v === null)
        return (
          <div className="text-right text-[10px] text-muted-foreground">
            geçmiş yetersiz ({fmtInt(row.original.lifetimeOrderCount)} sipariş)
          </div>
        );
      return <div className="text-right tabular-nums">{fmtNum(v)} günde bir</div>;
    },
  },
  {
    accessorKey: "daysSinceLastOrder",
    header: () => <div className="text-right">Sessiz</div>,
    cell: ({ row }) => {
      const d = row.original.daysSinceLastOrder;
      if (d === null) return <div className="text-right text-muted-foreground">—</div>;
      const interval = row.original.avgIntervalDays;
      const risky = interval !== null && d / interval >= 2;
      return (
        <div className={`text-right tabular-nums ${risky ? "font-medium text-destructive" : ""}`}>
          {fmtInt(d)} gün
        </div>
      );
    },
  },
  {
    accessorKey: "cancelRatePct",
    header: () => <div className="text-right">İptal</div>,
    // Oran METRAJ üzerinden: adet üzerinden olsaydı 1 metrelik numune iptali
    // 5000 metrelik iptalle aynı ağırlıkta görünürdü.
    cell: ({ row }) => {
      const p = row.original.cancelRatePct;
      if (p === 0) return <div className="text-right text-muted-foreground">—</div>;
      return (
        <div className={`text-right tabular-nums ${p >= 20 ? "font-medium text-destructive" : ""}`}>
          {fmtPercent(p)}
          <span className="ml-1 text-[10px] text-muted-foreground">
            {fmtNum(row.original.cancelledQty)} m
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "shippedQty",
    header: () => <div className="text-right">Sevk (brüt)</div>,
    // ⚠️ Sipariş sütunuyla AYNI siparişlere ait değil — bugün sevk edilen mal
    // eski bir siparişten gelmiş olabilir. Bu yüzden "karşılanma oranı" gibi
    // bir yüzde BASILMAZ; iki sayı yan yana durur, bölme kullanıcıya bırakılmaz.
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "topItemName",
    header: "Favori kumaş / renk",
    cell: ({ row }) => (
      <span>
        {row.original.topItemName ?? "—"}
        {row.original.topColorName ? (
          <span className="ml-1 text-[10px] text-muted-foreground">
            · {row.original.topColorName}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "firstOrderDate",
    header: "İlk sipariş",
    // "Ne zamandan beri müşterimiz" — yeni kazanılan bir müşterinin düşük
    // metrajı ile kaybedilmekte olanınki aynı satırda aynı görünüyordu.
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return (
        <span className="text-muted-foreground">{v ? fmtDate(v) : "—"}</span>
      );
    },
  },
];

const riskColumns: ColumnDef<AtRiskCustomerRow, unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "lastOrderDate",
    header: "Son sipariş",
    cell: ({ getValue }) => <span>{fmtDate(getValue() as string)}</span>,
  },
  {
    accessorKey: "daysSinceLastOrder",
    header: () => <div className="text-right">Sessiz</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums text-destructive">
        {fmtInt(getValue() as number)} gün
      </div>
    ),
  },
  {
    accessorKey: "avgIntervalDays",
    header: () => <div className="text-right">Normal ritmi</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} günde bir</div>
    ),
  },
  {
    accessorKey: "overdueRatio",
    header: () => <div className="text-right">Kat</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-bold tabular-nums text-destructive">
        {fmtNum(getValue() as number)}×
      </div>
    ),
  },
  {
    accessorKey: "lifetimeQty",
    header: () => <div className="text-right">Toplam iş</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtNum(row.original.lifetimeQty)} m
        <span className="ml-1 text-[10px] text-muted-foreground">
          / {fmtInt(row.original.lifetimeOrderCount)} sipariş
        </span>
      </div>
    ),
  },
];

export function CustomerScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("customer/scorecard");
  const compare = useReportCompare();
  const [axis, setAxis] = useState<SortAxis>("totalQty");

  const query = useQuery({
    queryKey: ["reports", "customer", "scorecard", params, compare.params],
    queryFn: () => customerScorecardApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (sc ? buildCustomerScorecardExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  /**
   * Görünüm sıralaması — SUNUCUNUN sırasını (metraj DESC) yalnız EKRAN için
   * değiştirir. Excel çıktısı bilerek her zaman metraj sırasında kalır: dosya
   * bağlamından koparak dolaşır ve "hangi eksene göre sıralıydı" bilgisi
   * kaybolur; sıralaması değişken bir dosya iki kişi arasında farklı okunur.
   * Son anahtar daima ad — eşitlikte sıra koşumdan koşuma oynamasın.
   */
  const ranking = useMemo(() => {
    const rows = [...(sc?.ranking ?? [])];
    if (axis === "totalQty") return rows; // sunucu sırası zaten bu
    return rows.sort(
      (a, b) => (b[axis] as number) - (a[axis] as number) ||
        b.totalQty - a.totalQty ||
        a.customerName.localeCompare(b.customerName, "tr"),
    );
  }, [sc, axis]);

  const axisHint = SORT_AXES.find((a) => a.key === axis)?.hint ?? "";

  return (
    <ReportPageLayout
      reportKey="customer/scorecard"
      title="Müşteri Karnesi"
      description="En çok veren, en sık veren ve kaybolmakta olan müşteri — tek ekranda."
      // Varsayılan 90 gün: 30 günlük pencere sıklık/ABC için fazla dar kalıyor.
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      {/* İki zaman kapsamının farkı EKRANDA yazılı — aksi halde aynı satırdaki
          iki sütunun farklı dönemi anlattığı görünmez. */}
      <p className="text-xs text-muted-foreground">
        Sıralama ve metrajlar <strong>seçili döneme</strong> aittir. "Sıklık" ve "Sessiz"
        sütunları ise <strong>tüm geçmişten</strong> hesaplanır — dönem içine sıkıştırılsalardı
        30 günlük bir pencerede herkes sessiz görünürdü.
      </p>

      {/* Kullanıcının bildirdiği yanılgı EKRANDA yazılı: sipariş adedi bir
          müşteri ölçüsü değil, bir GİRİŞ ALIŞKANLIĞI ölçüsüdür. Bu cümle
          olmadan tablo doğru sayıları basar ve yine yanlış okunur. */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          <strong>"Sipariş" sütunu belge sayısıdır.</strong> Aynı işi 10 kaleme tek siparişte
          yazan müşteri burada <strong>1</strong>, 10 ayrı siparişe yazan{" "}
          <strong>10</strong> görünür — ikisi de aynı işi vermiştir. Bu yüzden sıklığı üç
          sütun birlikte anlatır: <strong>Sipariş</strong> (belge) ·{" "}
          <strong>Kalem</strong> (kaç ayrı mal) · <strong>Sipariş günü</strong> (kaç ayrı
          gün — aynı gün girilen 5 sipariş 1 sayılır). <strong>Kalem/sipariş</strong> bir
          sıralama ölçütü değil, hangi alışkanlıkla karşı karşıya olduğunuzu söyleyen
          anahtardır{sc ? ` (fabrika ortalaması ${fmtNum(sc.summary.avgLinesPerOrder)})` : ""}.
          Metraj bu ayrımdan etkilenmez — ABC sıralaması bu yüzden metraja dayanır.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Sipariş veren müşteri"
          value={fmtInt(sc?.summary.customerCount)}
          hint={
            sc?.summary.prevCustomerCount !== undefined
              ? `Önceki dönem ${fmtInt(sc.summary.prevCustomerCount)}`
              : undefined
          }
          icon={Users}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="A sınıfı müşteri"
          value={fmtInt(sc?.summary.aClassCount)}
          hint={sc ? `Metrajın %${fmtNum(sc.summary.aClassQtyPct)}'ini taşıyor` : undefined}
          icon={Crown}
          tone="ok"
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Risk altında"
          value={fmtInt(sc?.summary.atRiskCount)}
          hint="Kendi ritminin 2 katıdır sessiz"
          icon={AlertTriangle}
          tone={sc === undefined ? "neutral" : sc.summary.atRiskCount > 0 ? "bad" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Dönemde sessiz"
          value={fmtInt(sc?.summary.dormantCount)}
          hint="Geçmişte sipariş verdi, bu dönemde vermedi"
          icon={Repeat}
          isLoading={query.isLoading}
        />
        {/* Fabrika geneli kalem/sipariş — tek tek satırdaki değerin "yüksek mi"
            olduğu ancak bu ortalamaya göre söylenebilir; mutlak eşik yoktur. */}
        <MetricCard
          label="Kalem / sipariş"
          value={fmtNum(sc?.summary.avgLinesPerOrder)}
          hint={
            sc
              ? `${fmtInt(sc.summary.orderCount)} sipariş · ${fmtInt(sc.summary.lineCount)} kalem`
              : undefined
          }
          icon={Layers}
          isLoading={query.isLoading}
        />
      </div>

      {sc && sc.summary.insufficientHistoryCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(sc.summary.insufficientHistoryCount)} müşterinin</strong> sipariş
            geçmişi ritim hesaplamak için yetersiz (3'ten az sipariş). Risk listesine{" "}
            <strong>girmediler</strong> — riskli olmadıkları için değil, ölçülemedikleri için.
            Bu sayı azaldıkça risk listesi güvenilirleşir.
          </span>
        </div>
      ) : null}

      <DetailTable<AtRiskCustomerRow>
        title="Kaybolan müşteri riski"
        description="Kendi sipariş ritminin en az 2 katı kadar sessiz kalmış müşteriler. Dönemden bağımsızdır."
        data={sc?.atRisk ?? []}
        columns={riskColumns}
        isLoading={query.isLoading}
        emptyLabel="Ritmine göre gecikmiş müşteri yok."
      />

      {/* Sıralama ekseni seçici — "en çok veren" ile "en sık veren" farklı
          sorulardır ve tek bir sabit sıralama, kullanıcının sorusunu bizim
          seçtiğimiz ölçüye zorlardı. */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-1 text-muted-foreground">Sırala:</span>
        {SORT_AXES.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant={axis === a.key ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setAxis(a.key)}
          >
            {a.label}
          </Button>
        ))}
        <span className="ml-2 text-muted-foreground">{axisHint}</span>
      </div>

      <DetailTable<CustomerRankRow>
        title="Müşteri sıralaması (ABC)"
        description={
          axis === "totalQty"
            ? "Metraja göre sıralı. Kümülatif pay %80'e ulaşana kadar A, %95'e kadar B, gerisi C."
            : "ABC sınıfı ve kümülatif pay HER ZAMAN metraj sırasına göre hesaplanır; başka bir eksene göre sıraladığınızda o sütun artan görünmez ama her satırdaki değer doğrudur. Excel çıktısı daima metraj sırasındadır."
        }
        data={ranking}
        columns={rankColumns}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
