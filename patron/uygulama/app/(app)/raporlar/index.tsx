// Raporlar: istenebilir rapor kartları (fabrikanın `rapor-katalogu`ndan, izinliler) → isteklerim (durum rozetli) →
// hazır görünümler (fabrikanın hesapladığı anlıklar). Bekleyen istek varken ekran kısa yoklama yapar.
import { useRouter } from "expo-router";
import { View } from "react-native";
import { can } from "../../../src/lib/access";
import { formatDateTime, formatNumber } from "../../../src/lib/format";
import { reportDomain, reportPending, reportTitle } from "../../../src/lib/labels/finans";
import { catalogEntries, requestable } from "../../../src/lib/reports";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { useOpenRefresh } from "../../../src/state/useOpenRefresh";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { ReadyView, ReportStatusBadge, ReportTile, paramSummary, type ReadyStat } from "../../../src/ui/raporlar/parts";
import { usePendingPoll } from "../../../src/ui/raporlar/usePendingPoll";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { space } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown, digits = 0) => formatNumber(v, digits);
const pct = (v: unknown) => (formatNumber(v, 1) === "—" ? "—" : `%${formatNumber(v, 1)}`);
const positive = (v: unknown) => typeof v === "number" && v > 0;

/** Açık sipariş karşılama: karşılanma yüzdesi, açık kalem, geciken kalem (fabrikanın sayıları). */
function coverageStats(veri: unknown): ReadyStat[] {
  const o = obj(obj(veri).ozet);
  return [
    { label: "Karşılanma", value: pct(o.karsilanmaYuzde) },
    { label: "Açık kalem", value: `${num(o.acikKalem)} kalem` },
    { label: "Geciken kalem", value: `${num(o.gecikenKalem)} kalem`, tone: positive(o.gecikenKalem) ? "kritik" : undefined },
  ];
}

/** Stok karnesi: bitmiş, ham ve ölü stok miktarı (birim anlıkta yok → uydurulmaz). */
function stockStats(veri: unknown): ReadyStat[] {
  const o = obj(obj(veri).ozet);
  return [
    { label: "Bitmiş miktar", value: num(o.bitmisMiktar, 1) },
    { label: "Ham miktar", value: num(o.hamMiktar, 1) },
    { label: `Ölü stok (${num(o.oluStokGun)}+ gün)`, value: num(o.oluMiktar, 1), tone: positive(o.oluMiktar) ? "uyari" : undefined },
  ];
}

export default function Reports() {
  const { api, permissions } = useSession();
  const router = useRouter();
  const catalog = useRemote("anlik:rapor-katalogu", () => api.snapshot("rapor-katalogu"));
  const mine = useRemote("raporlar:benim", () => api.reportList({ limit: 50 }), { tags: ["rapor"] });
  const coverage = useRemote(can(permissions, "bulut:siparis:oku") ? "anlik:acik-siparis-karsilama" : null, () => api.snapshot("acik-siparis-karsilama"));
  const stock = useRemote(can(permissions, "bulut:stok:oku") ? "anlik:stok-karnesi" : null, () => api.snapshot("stok-karnesi"));
  useOpenRefresh();
  const all = catalogEntries(catalog.data?.veri);
  const entries = all.filter((e) => requestable(e.anahtar, permissions));
  const requests = mine.data?.kayitlar ?? [];
  usePendingPoll(requests.some((r) => reportPending(r.durum)), mine.reload);
  const refresh = () => {
    catalog.reload();
    mine.reload();
    if (coverage.data || coverage.error) coverage.reload();
    if (stock.data || stock.error) stock.reload();
  };
  // Katalog girdisi fabrikanın "soru"sunu da taşır (tel şeması); yoksa kart yalnız başlıkla çizilir.
  const soru = (e: object): string | undefined => {
    const v = (e as Obj).soru;
    return typeof v === "string" && v !== "" ? v : undefined;
  };

  return (
    <Screen module="raporlar" onRefresh={refresh} refreshing={mine.refreshing || catalog.refreshing}>
      <SectionHeader title="Rapor iste" domain="raporlar" />
      {catalog.loading && !catalog.data ? <LoadingSkeleton variant="kpi" rows={4} /> : null}
      {catalog.error && !catalog.data ? <Empty text="Fabrikadan rapor kataloğu henüz gelmedi" domain="raporlar" icon={EMPTY_ICON.bekliyor} actionLabel="Tekrar dene" onAction={catalog.reload} /> : null}
      {catalog.data && entries.length === 0 ? <Empty text="İsteyebileceğiniz rapor yok" domain="raporlar" icon={EMPTY_ICON.yetki} /> : null}
      {entries.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
          {entries.map((e) => (
            <ReportTile key={e.anahtar} anahtar={e.anahtar} baslik={e.baslik} soru={soru(e)} onPress={() => router.push({ pathname: "/raporlar/yeni", params: { anahtar: e.anahtar } } as never)} />
          ))}
        </View>
      ) : null}

      <SectionHeader title="İsteklerim" count={mine.data ? requests.length : undefined} />
      {mine.loading && !mine.data ? <LoadingSkeleton rows={3} /> : null}
      {mine.error && !mine.data ? <ErrorState text={mine.error} onRetry={mine.reload} /> : null}
      {mine.data && requests.length === 0 ? <Empty text="Henüz rapor istemediniz" domain="raporlar" /> : null}
      {requests.length > 0 ? (
        <ListGroup testID="isteklerim">
          {requests.map((r) => {
            const d = reportDomain(r.raporAnahtari);
            return (
              <ListRow
                key={r.id}
                testID={`rapor-${r.id}`}
                title={reportTitle(r.raporAnahtari, all)}
                subtitle={`${paramSummary(r.parametreler)} · ${formatDateTime(r.olusturulma).replace(/^(\d{2}\.\d{2})\.\d{4} /, "$1 ")}`}
                icon={d.icon}
                domain={d.domain}
                accessory={<ReportStatusBadge status={r.durum} testID={`rapor-durum-${r.id}`} compact />}
                onPress={() => router.push({ pathname: "/raporlar/[id]", params: { id: r.id } } as never)}
              />
            );
          })}
        </ListGroup>
      ) : null}

      {coverage.data || coverage.loading || coverage.error || stock.data || stock.loading || stock.error ? <SectionHeader title="Hazır görünümler" /> : null}
      {can(permissions, "bulut:siparis:oku") ? (
        <ReadyView projection="acik-siparis-karsilama" title="Açık sipariş karşılama" domain="siparisler" icon="receipt-outline" remote={coverage} stats={coverageStats} />
      ) : null}
      {can(permissions, "bulut:stok:oku") ? <ReadyView projection="stok-karnesi" title="Stok karnesi" domain="stok" icon="cube-outline" remote={stock} stats={stockStats} /> : null}
    </Screen>
  );
}

