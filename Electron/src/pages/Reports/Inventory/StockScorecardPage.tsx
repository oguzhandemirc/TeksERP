import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Layers, PackageSearch, Warehouse } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, DetailTable, MetricCard, ReportExportBar, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtNum } from "../_components/formatters";
import { buildStockExport, stockScorecardApi } from "./stockScorecard";
import { buildStockKalemExport, kalemErrorText, stockKalemApi } from "./stockKalem";
import { itemColumns, oldColumns } from "./stockScorecardColumns";
import { StockKalemTab } from "./StockKalemTab";

type Sekme = "genel" | "kalem";

export function StockScorecardPage() {
  const query = useQuery({
    queryKey: ["reports", "inventory", "scorecard"],
    queryFn: () => stockScorecardApi.get(),
    staleTime: 30_000,
  });

  const [sekme, setSekme] = useState<Sekme>("genel");
  // Kalem sekmesi açılınca yüklenir; Excel/PDF o an açık sekmenin tablolarını basar.
  const kalemQuery = useQuery({
    queryKey: ["reports", "inventory", "scorecard", "kalem"],
    queryFn: () => stockKalemApi.get(),
    staleTime: 30_000,
    enabled: sekme === "kalem",
  });

  const sc = query.data?.data;
  const kalem = kalemQuery.data?.data;
  const kalemWarnings = kalemQuery.data?.warnings;
  const spec = useMemo(
    () => () => (sekme === "kalem" ? (kalem ? buildStockKalemExport(kalem, kalemWarnings) : null) : sc ? buildStockExport(sc) : null),
    [sekme, sc, kalem, kalemWarnings],
  );
  const exportDisabled = sekme === "kalem" ? !kalem : !sc;

  return (
    <ReportPageLayout
      reportKey="inventory/scorecard"
      title="Stok & Ölü Stok"
      description="Rafta ne var, kaç gündür duruyor ve siparişi var mı — nakit sıkışmasının kaynağı."
      // Anlık durum raporu: tarih aralığı YOK. "Şu an rafta ne var" sorusunu
      // filtrelemek anlamsızdır.
      actions={<ReportExportBar disabled={exportDisabled} buildSpec={spec} />}
    >
      <Tabs value={sekme} onValueChange={(v) => setSekme(v as Sekme)}>
        <TabsList>
          <TabsTrigger value="genel">Genel</TabsTrigger>
          <TabsTrigger value="kalem">Kalem bazında</TabsTrigger>
        </TabsList>
        <TabsContent value="genel" className="flex flex-col gap-4">
          {sc && sc.summary.unagedCount > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <strong>{fmtInt(sc.summary.unagedCount)} topun</strong> ({fmtNum(sc.summary.unagedQty)} m) yaşı
                bilinmiyor — yaş dağılımına dahil değil. "Yaşı bilinmiyor", "yeni" demek değildir; bu toplar ölü
                stok hesabına da girmez.
              </span>
            </div>
          ) : null}

          {/* ⚠️ 5 kart lg'de (1024px) SIKIŞIYOR — ölçüldü: "9283,8 m" iki satıra
              kırılıyordu. Beşli sıra yalnız xl'den (1280px) itibaren; arada üçlü. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <MetricCard
              label="Ölü stok"
              value={`${fmtNum(sc?.summary.deadQty)} m`}
              hint={sc ? `${sc.summary.deadStockDays} günden eski VE siparişsiz` : undefined}
              icon={AlertTriangle}
              tone={sc === undefined ? "neutral" : sc.summary.deadQty > 0 ? "bad" : "ok"}
              isLoading={query.isLoading}
            />
            <MetricCard
              label="Bitmiş depo"
              value={`${fmtNum(sc?.summary.finishedQty)} m`}
              hint={sc ? `${fmtInt(sc.summary.finishedCount)} top` : undefined}
              icon={Warehouse}
              isLoading={query.isLoading}
            />
            <MetricCard
              label="Ham stok"
              value={`${fmtNum(sc?.summary.rawQty)} m`}
              hint={sc ? `${fmtInt(sc.summary.rawCount)} top — işlenmeyi bekliyor` : undefined}
              icon={Boxes}
              isLoading={query.isLoading}
            />
            {/* Yarı mamul AYRI kart: aynı statüyü (STOCK) paylaşır ama farklı stok
                türüdür ve Envanter'de de ayrı sekmede durur. Tek rakamda toplamak
                "ekran 800 diyor, rapor 950 diyor" çelişkisini üretirdi. */}
            <MetricCard
              label="Yarı mamul"
              value={`${fmtNum(sc?.summary.semiQty)} m`}
              hint={sc ? `${fmtInt(sc.summary.semiCount)} top — dışarıdan boyalı geldi` : undefined}
              icon={Layers}
              isLoading={query.isLoading}
            />
            <MetricCard
              label="Eşikten eski"
              value={`${fmtNum(sc?.summary.agedQty)} m`}
              // Bu, ölü stoktan FARKLI ve büyük olması normal: siparişi olan eski
              // mal da buraya girer. İkisini karıştırmamak için hint açık yazıyor.
              hint="Siparişi olsa da olmasa da — ölü stokla aynı şey değil"
              icon={PackageSearch}
              isLoading={query.isLoading}
            />
          </div>

          <ChartCard
            title="Yaş dağılımı (bitmiş depo)"
            height={220}
            isLoading={query.isLoading}
            isEmpty={!query.isLoading && (sc?.byAge.every((b) => b.qty === 0) ?? true)}
          >
            <SimpleBarChart
              data={sc?.byAge ?? []}
              xKey="label"
              bars={[{ key: "qty", label: "Metraj (m)" }]}
              formatValue={(v) => fmtNum(v)}
            />
          </ChartCard>

          <DetailTable
            title="Kumaş Bazında"
            description="Siparişsiz metraj SPEC bazındadır (kumaş+renk+en) — hangi fiziksel topun karşılıksız olduğu iddia edilmez."
            data={sc?.byItem ?? []}
            columns={itemColumns}
            isLoading={query.isLoading}
            emptyLabel="Rafta bitmiş mal yok"
          />

          <DetailTable
            title="En eski toplar"
            description="Raftaki en uzun süredir bekleyen 25 top."
            data={sc?.oldest ?? []}
            columns={oldColumns}
            isLoading={query.isLoading}
            emptyLabel="Yaş çıpası olan top yok"
          />
        </TabsContent>
        <TabsContent value="kalem">
          <StockKalemTab
            data={kalem}
            isLoading={kalemQuery.isLoading}
            warnings={kalemWarnings}
            errorText={kalemQuery.isError ? kalemErrorText(kalemQuery.error) : undefined}
          />
        </TabsContent>
      </Tabs>
    </ReportPageLayout>
  );
}
