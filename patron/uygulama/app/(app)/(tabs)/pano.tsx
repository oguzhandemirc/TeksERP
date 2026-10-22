// Pano — "patron 10 saniyede ne görmeli": tesis + rol + eşitleme · Dikkat şeridi · bugünün kahramanı · 4 KPI ·
// alan kartları (DASHBOARD_CARDS izinleriyle; izinsiz kart çizilmez). Özet izni olmayan çalışan boş ekran yerine
// "Görebildiğin alanlar" listesini görür. Sayılar fabrikanın; uygulama karşılaştırma hesaplamaz.
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { can, visibleCards, visibleModules, type ModuleKey } from "../../../src/lib/access";
import { PERIOD_LABEL, UNIT } from "../../../src/lib/labels/uretim";
import { useSession } from "../../../src/state/session";
import { useOpenRefresh } from "../../../src/state/useOpenRefresh";
import { FacilityName, Screen, useWide } from "../../../src/ui/Frame";
import { HeroSummary } from "../../../src/ui/HeroSummary";
import { DOMAIN_ICON, MODULE_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { AttentionStrip } from "../../../src/ui/pano/AttentionStrip";
import { MetricGrid, MetricTile, type MetricLine } from "../../../src/ui/pano/MetricTile";
import { areaSummary, attentionItems, column, dueAmount, dueRows, dueShort, obj, period, pct, qty, type AttentionItem } from "../../../src/ui/pano/read";
import { FactoryStamp } from "../../../src/ui/pano/SnapshotGate";
import { combine, useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { RoleBadge } from "../../../src/ui/RoleBadge";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { LoadingSkeleton } from "../../../src/ui/StateViews";
import { SyncIndicator } from "../../../src/ui/SyncIndicator";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography, type Domain } from "../../../src/ui/tokens";

/** Alan kartı → gidilecek bölüm + renk kimliği (Fason üretimin içinde, finans özeti Finans'ta). */
const CARD_TARGET: Readonly<Record<string, { route: string; domain: Domain; module: ModuleKey }>> = {
  "ozet.siparis": { route: "/siparisler", domain: "siparisler", module: "siparisler" },
  "ozet.sevkiyat": { route: "/sevkiyat", domain: "sevkiyat", module: "sevkiyat" },
  "ozet.uretim": { route: "/uretim", domain: "uretim", module: "uretim" },
  "ozet.stok": { route: "/stok", domain: "stok", module: "stok" },
  "ozet.fason": { route: "/uretim", domain: "fason", module: "uretim" },
  "ozet-finans": { route: "/finans", domain: "finans", module: "finans" },
};

/** Çalışan hesabındaki alan satırlarının kısa açıklaması. */
const MODULE_HINT: Readonly<Partial<Record<ModuleKey, string>>> = {
  siparisler: "Açık siparişler ve termin",
  cariler: "Müşteri ve tedarikçi kartları",
  sevkiyat: "Son sevkler ve zamanında teslim",
  uretim: "İstasyonlar ve iş emirleri",
  stok: "Ham, yarı mamul ve bitmiş stok",
  finans: "Kasa, çek, fatura ve tahsilat",
  raporlar: "Hazır raporlar ve istekler",
  "gelen-kutusu": "Fabrikaya gönderdiğin talepler",
  hesaplar: "Kullanıcılar ve yetkiler",
  bildirimler: "Uyarı ve bildirim ayarları",
  profil: "Hesabın, parola ve oturum",
};

export default function Dashboard() {
  const { facility, permissions, factoryStamp, offline, refresh } = useSession();
  const router = useRouter();
  const wide = useWide();
  const s = useStyles();
  useOpenRefresh();
  const cards = visibleCards(permissions);
  const on = (p: string) => cards.some((c) => c.projection === p);
  const orders = useSnapshot("ozet.siparis", on("ozet.siparis"));
  const shipping = useSnapshot("ozet.sevkiyat", on("ozet.sevkiyat"));
  const production = useSnapshot("ozet.uretim", on("ozet.uretim"));
  const stock = useSnapshot("ozet.stok", on("ozet.stok"));
  const subcontract = useSnapshot("ozet.fason", on("ozet.fason"));
  const finance = useSnapshot("ozet-finans", on("ozet-finans"));
  const health = useSnapshot("saglik", can(permissions, "bulut:ozet:oku"));
  const byProjection = { "ozet.siparis": orders, "ozet.sevkiyat": shipping, "ozet.uretim": production, "ozet.stok": stock, "ozet.fason": subcontract, "ozet-finans": finance } as const;
  const all = combine([orders, shipping, production, stock, subcontract, finance, health]);
  const reloadAll = () => {
    void refresh();
    all.reload();
  };

  const veri = (r: { data: { veri: unknown } | null }) => r.data?.veri;
  const items = attentionItems({ health: veri(health), orders: veri(orders), finance: veri(finance), lastSync: facility ? factoryStamp : undefined });
  const open = (i: AttentionItem) => (i.action === "esitle" ? reloadAll() : i.route ? router.push(i.route as never) : undefined);
  const firstLoad = cards.length > 0 && cards.every((c) => !byProjection[c.projection as keyof typeof byProjection]?.data) && [orders, shipping, production, stock, subcontract, finance].some((r) => r.loading);

  const header = (
    <View style={s.header}>
      {!wide ? <FacilityName /> : null}
      <View style={s.headerRow}>
        {!wide ? (
          <View>
            <RoleBadge permissions={permissions} />
          </View>
        ) : null}
        <SyncIndicator last={factoryStamp} offline={offline} onPress={reloadAll} />
      </View>
    </View>
  );

  return (
    <Screen title="Pano" back={false} subtitle={header} onRefresh={reloadAll} refreshing={all.refreshing}>
      {cards.length === 0 ? (
        <Reachable permissions={permissions} onOpen={(route) => router.push(route as never)} />
      ) : (
        <>
          <SectionHeader title="Dikkat" count={items.length > 0 ? items.length : undefined} testID="bolum-dikkat" />
          <AttentionStrip items={items} checked={checkedText(permissions, on)} onOpen={open} />
          {firstLoad ? <LoadingSkeleton variant="kpi" rows={4} testID="pano-yukleniyor" /> : null}
          {production.data ? <TodayHero production={production.data} shipping={veri(shipping)} orders={veri(orders)} offline={production.offline} /> : null}
          <MetricGrid testID="pano-kpi">
            {shipping.data ? <ShipTodayTile data={shipping.data.veri} onPress={() => router.push("/sevkiyat" as never)} /> : null}
            {orders.data ? <OpenOrdersTile data={orders.data.veri} onPress={() => router.push("/siparisler" as never)} /> : null}
            {finance.data ? <DueTile data={finance.data.veri} onPress={() => router.push("/finans" as never)} /> : null}
            {production.data ? <QueueTile data={production.data.veri} onPress={() => router.push("/uretim" as never)} /> : null}
          </MetricGrid>
          <SectionHeader title="Alanlar" testID="bolum-alanlar" />
          <ListGroup testID="alan-kartlari">
            {cards.map((c) => {
              const target = CARD_TARGET[c.projection];
              const r = byProjection[c.projection as keyof typeof byProjection];
              const subtitle = r?.data ? areaSummary(c.projection, r.data.veri) : r?.error ? r.error : r?.loading ? "Yükleniyor…" : "Fabrikadan henüz gelmedi";
              return (
                <ListRow
                  key={c.projection}
                  title={c.title}
                  subtitle={subtitle}
                  domain={target?.domain ?? "genel"}
                  icon={target ? DOMAIN_ICON[target.domain] : undefined}
                  onPress={target ? () => router.push(target.route as never) : undefined}
                  testID={`anlik-${c.projection}`}
                />
              );
            })}
          </ListGroup>
        </>
      )}
      {facility?.esitleme?.sozlesmeUyarisi ? <Text style={s.note}>{facility.esitleme.sozlesmeUyarisi}</Text> : null}
    </Screen>
  );
}

function checkedText(perms: readonly string[], on: (p: string) => boolean): string {
  const parts = [can(perms, "bulut:ozet:oku") ? "yedek" : null, on("ozet.siparis") ? "siparişler" : null, on("ozet-finans") ? "çek vadeleri" : null, "eşitleme"];
  return `${parts.filter(Boolean).join(", ")} kontrol edildi`;
}

/** Bugünün kahramanı: istasyonlarda bugün biten top + bu ayın sevk/karşılanma oranları (fabrika sayıları). */
function TodayHero({ production, shipping, orders, offline }: { readonly production: { veri: unknown; surum: string; projeksiyon: string }; readonly shipping: unknown; readonly orders: unknown; readonly offline: boolean }) {
  const p = obj(production.veri);
  const month = period(shipping, "buAy");
  const minis = [
    shipping !== undefined ? { label: `${PERIOD_LABEL.buAy} sevk`, value: `${qty(month.sevkMiktari)} ${UNIT.metre}` } : null,
    shipping !== undefined ? { label: "Zamanında", value: pct(month.zamanindaYuzde) } : null,
    orders !== undefined ? { label: "Karşılanma", value: pct(obj(orders).karsilanmaYuzde) } : null,
  ].filter((m): m is { label: string; value: string } => m !== null);
  return (
    <View>
      <HeroSummary
        title="Bugün tamamlanan üretim"
        value={qty(p.bugunTamamlananToplam)}
        unit={UNIT.top}
        caption="İstasyonlarda bugün biten toplar"
        domain="uretim"
        icon="today-outline"
        minis={minis}
        testID="pano-kahraman"
      />
      <FactoryStamp snap={production} offline={offline} />
    </View>
  );
}

function ShipTodayTile({ data, onPress }: { readonly data: unknown; readonly onPress: () => void }) {
  const today = period(data, "bugun");
  const month = period(data, "buAy");
  const last = period(data, "gecenAy");
  return (
    <MetricTile
      label="Bugün sevk"
      value={qty(today.sevkMiktari)}
      unit={UNIT.metre}
      caption={`${qty(today.sevkTopSayisi)} ${UNIT.top} · brüt`}
      domain="sevkiyat"
      lines={[
        { label: PERIOD_LABEL.buAy, value: `${qty(month.sevkMiktari)} ${UNIT.metre}` },
        { label: PERIOD_LABEL.gecenAy, value: `${qty(last.sevkMiktari)} ${UNIT.metre}` },
      ]}
      onPress={onPress}
      testID="kpi-bugun-sevk"
    />
  );
}

function OpenOrdersTile({ data, onPress }: { readonly data: unknown; readonly onPress: () => void }) {
  const d = obj(data);
  const late = typeof d.gecikenKalem === "number" && d.gecikenKalem > 0;
  const lines: MetricLine[] = [
    { label: "Açık miktar", value: `${qty(d.acikMiktar)} ${UNIT.metre}` },
    { label: "Geciken", value: `${qty(d.gecikenKalem)} ${UNIT.kalem}`, tone: late ? "kritik" : undefined },
  ];
  return (
    <MetricTile
      label="Açık sipariş"
      value={qty(d.acikKalem)}
      unit={UNIT.kalem}
      caption={`${pct(d.karsilanmaYuzde)} karşılandı`}
      domain="siparisler"
      status={late ? { kind: "kritik", label: "Geciken var" } : { kind: "iyi", label: "Gecikme yok" }}
      lines={lines}
      onPress={onPress}
      testID="kpi-acik-siparis"
    />
  );
}

/** Vadesi yaklaşan (7 gün) çek/senet: döviz ve yön ayrı satır; toplanmaz. */
function DueTile({ data, onPress }: { readonly data: unknown; readonly onPress: () => void }) {
  const soon = dueRows(data, ["SOON"]);
  const overdue = dueRows(data, ["OVERDUE"]);
  const first = soon[0];
  return (
    <MetricTile
      label="Vadesi yaklaşan"
      value={first ? dueAmount(first) : "Yok"}
      caption={first ? `${dueShort(first)} · 7 gün içinde` : "7 gün içinde vadesi gelen çek/senet yok"}
      domain="finans"
      icon="calendar-outline"
      status={overdue.length > 0 ? { kind: "kritik", label: "Geçmiş var" } : undefined}
      lines={soon.slice(1, 3).map((r) => ({ label: dueShort(r), value: dueAmount(r) }))}
      lineLayout="stack"
      onPress={onPress}
      testID="kpi-vade"
    />
  );
}

/** Üretim kuyruğu: yarı mamul kolonu (Kanban ile aynı kaynak, top sayısı); yanında fason ve depo. */
function QueueTile({ data, onPress }: { readonly data: unknown; readonly onPress: () => void }) {
  const semi = column(data, "yariMamul");
  const fason = column(data, "fason");
  const depot = column(data, "depo");
  const lines = [fason, depot].flatMap((c) => (c ? [{ label: c.label, value: `${qty(c.count)} ${UNIT.top}` }] : []));
  return (
    <MetricTile
      label="Üretim kuyruğu"
      value={qty(semi?.count)}
      unit={UNIT.top}
      caption={semi ? `${semi.label} · şu an` : "Akış verisi yok"}
      domain="uretim"
      icon="layers-outline"
      lines={lines}
      onPress={onPress}
      testID="kpi-uretim-kuyrugu"
    />
  );
}

/** Özet izni olmayan hesap: görebildiği bölümler (izinliler) gruplu liste olarak. */
function Reachable({ permissions, onOpen }: { readonly permissions: readonly string[]; readonly onOpen: (route: string) => void }) {
  const s = useStyles();
  const mods = visibleModules(permissions).filter((m) => m.key !== "pano");
  return (
    <View testID="gorebildigin-alanlar">
      <Text style={s.intro}>Fabrika özetini görme yetkin yok; aşağıdaki bölümlerle çalışabilirsin. Özet için tesis yöneticine başvur.</Text>
      <SectionHeader title="Görebildiğin alanlar" count={mods.length} />
      <ListGroup>
        {mods.map((m) => (
          <ListRow
            key={m.key}
            title={m.title}
            subtitle={MODULE_HINT[m.key]}
            domain={MODULE_ICON[m.key].domain}
            icon={MODULE_ICON[m.key].icon}
            onPress={() => onOpen(m.route)}
            testID={`kisayol-${m.key}`}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  header: { gap: space.xs, marginTop: space.xs },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, flexWrap: "wrap" as const },
  intro: { ...typography.callout, color: t.textSecondary, marginTop: space.s },
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.m },
}));
