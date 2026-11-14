// Pano — sıkı, kişiselleştirilebilir: başlık satırında eşitleme · Dikkat (yalnız madde varsa) · seçili kutular.
// Fabrika `patronPano` yayımlıyorsa kutular panelin açılış panosu kataloğundan (hesap fabrikada); değilse yerel
// anlık kutuları. Kutu seçimi + sıra cihazda (`usePanoDuzeni`). Özet izni olmayan çalışan "Görebildiğin alanlar"ı görür.
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { yetenek } from "../../../src/api/yetenek";
import { PANO_DONEMLERI, type PanoDonem, type PanoKutuTanimi } from "../../../src/api/pano";
import { can, MODULES, moduleVisible, visibleCards, visibleModules, type ModuleKey } from "../../../src/lib/access";
import { PERIOD_LABEL, UNIT } from "../../../src/lib/labels/uretim";
import { TERIM } from "../../../src/lib/terim";
import { useSession } from "../../../src/state/session";
import { useOpenRefresh } from "../../../src/state/useOpenRefresh";
import { useRemote } from "../../../src/state/useRemote";
import { FacilityName, Screen, useWide } from "../../../src/ui/Frame";
import { MODULE_ICON } from "../../../src/ui/icons";
import { KpiCard, KpiGrid, type KpiCardProps } from "../../../src/ui/KpiCard";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { AttentionStrip } from "../../../src/ui/pano/AttentionStrip";
import { cihazDeposu, usePanoDuzeni, type KatalogKutusu } from "../../../src/ui/pano/duzen";
import { KUTU_META, kutuGorunum, MOBILDE_YOK } from "../../../src/ui/pano/kutu-gorunum";
import { PanoDuzenleyici } from "../../../src/ui/pano/PanoDuzenleyici";
import { areaSummary, attentionItems, column, dueAmount, dueRows, dueShort, obj, pct, period, qty, type AttentionItem } from "../../../src/ui/pano/read";
import { combine, useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { HeaderIconButton } from "../../../src/ui/siparis/parts";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { SyncIndicator } from "../../../src/ui/SyncIndicator";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

/** Çalışan hesabındaki alan satırlarının kısa açıklaması. */
const MODULE_HINT: Readonly<Partial<Record<ModuleKey, string>>> = {
  siparisler: "Açık siparişler ve termin",
  cariler: "Müşteri ve tedarikçi kartları",
  sevkiyat: "Son sevkler ve zamanında teslim",
  get uretim() { return `İstasyonlar ve ${TERIM.terbiyeIsEmri.cogulKucuk}`; },
  stok: "Ham, yarı mamul ve bitmiş stok",
  finans: "Kasa, çek, fatura ve tahsilat",
  raporlar: "Hazır raporlar ve istekler",
  "gelen-kutusu": "Fabrikaya gönderdiğin talepler",
  hesaplar: "Kullanıcılar ve yetkiler",
  bildirimler: "Uyarı ve bildirim ayarları",
  profil: "Hesabın, parola ve oturum",
};

const DEPO = cihazDeposu();

const DONEM_LABEL: Readonly<Record<PanoDonem, string>> = { bugun: "Bugün", hafta: "Hafta", ay: "Ay", yil: "Yıl" };

/** Yerel kutular (fabrika pano ucu yoksa): anahtar → gereken anlık + varsayılan mı. Sıra = varsayılan yerleşim. */
const YEREL_KATALOG: readonly (KatalogKutusu & { readonly projeksiyon: string })[] = [
  { anahtar: "kahraman", baslik: "Bugün tamamlanan üretim", aciklama: "İstasyonlarda bugün biten toplar", varsayilan: true, projeksiyon: "ozet.uretim" },
  { anahtar: "bugunSevk", baslik: "Bugün sevk", aciklama: "Bugün, bu ay ve geçen ay brüt sevk", varsayilan: true, projeksiyon: "ozet.sevkiyat" },
  { anahtar: "acikSiparis", baslik: "Açık sipariş", aciklama: "Açık kalem, karşılanma ve geciken", varsayilan: true, projeksiyon: "ozet.siparis" },
  { anahtar: "vade", baslik: "Vadesi yaklaşan", aciklama: "7 gün içinde vadesi gelen çek/senet", varsayilan: true, projeksiyon: "ozet-finans" },
  { anahtar: "kuyruk", baslik: "Üretim kuyruğu", aciklama: "Yarı mamul, fason ve depo", varsayilan: true, projeksiyon: "ozet.uretim" },
  { anahtar: "stok", baslik: "Stok", aciklama: "Stok özeti", varsayilan: false, projeksiyon: "ozet.stok" },
  { anahtar: "fason", baslik: "Fason", aciklama: "Fason özeti", varsayilan: false, projeksiyon: "ozet.fason" },
];

export default function Dashboard() {
  const { facility, permissions, factoryStamp, offline, refresh } = useSession();
  const router = useRouter();
  const wide = useWide();
  const s = useStyles();
  useOpenRefresh();
  const uzak = yetenek().pano;
  const cards = visibleCards(permissions);
  const [duzenle, setDuzenle] = useState(false);
  // Kutucuk yalnız açılabilen bölüme götürür (bölüm bu sunucuda yoksa dokunma bir şey yapmaz).
  const go = (route: string | undefined) => {
    if (!route) return undefined;
    const m = MODULES.find((x) => x.route === route);
    return m === undefined || moduleVisible(permissions, m.key) ? () => router.push(route as never) : undefined;
  };
  const has = (p: string) => cards.some((c) => c.projection === p);
  // Sipariş + finans anlığı Dikkat şeridini de besler (her kipte); diğerleri yalnız yerel kutular için.
  const on = (p: string) => !uzak && has(p);
  const orders = useSnapshot("ozet.siparis", has("ozet.siparis"));
  const finance = useSnapshot("ozet-finans", has("ozet-finans"));
  const shipping = useSnapshot("ozet.sevkiyat", on("ozet.sevkiyat"));
  const production = useSnapshot("ozet.uretim", on("ozet.uretim"));
  const stock = useSnapshot("ozet.stok", on("ozet.stok"));
  const subcontract = useSnapshot("ozet.fason", on("ozet.fason"));
  const health = useSnapshot("saglik", can(permissions, "bulut:ozet:oku"));
  const all = combine([orders, shipping, production, stock, subcontract, finance, health]);
  const veri = (r: { data: { veri: unknown } | null }) => r.data?.veri;

  const items = attentionItems({ health: veri(health), orders: veri(orders), finance: veri(finance), lastSync: facility ? factoryStamp : undefined });
  const reloadAll = () => {
    void refresh();
    all.reload();
  };
  const open = (i: AttentionItem) => (i.action === "esitle" ? reloadAll() : i.route ? router.push(i.route as never) : undefined);

  const yerelKatalog = useMemo(() => YEREL_KATALOG.filter((k) => cards.some((c) => c.projection === k.projeksiyon)), [cards]);
  const showPano = uzak || cards.length > 0;

  return (
    <Screen
      title="Pano"
      back={false}
      titleRight={<SyncIndicator last={factoryStamp} offline={offline} onPress={reloadAll} />}
      subtitle={!wide ? <FacilityName /> : undefined}
      headerRight={showPano ? <HeaderIconButton label="Panoyu düzenle" icon="options-outline" onPress={() => setDuzenle(true)} testID="pano-duzenle" /> : undefined}
      onRefresh={reloadAll}
      refreshing={all.refreshing}
    >
      {!showPano ? (
        <Reachable permissions={permissions} onOpen={(route) => router.push(route as never)} />
      ) : (
        <>
          {items.length > 0 ? <AttentionStrip items={items} checked="" onOpen={open} /> : null}
          {uzak ? (
            <UzakPano go={go} duzenle={duzenle} kapat={() => setDuzenle(false)} />
          ) : (
            <YerelPano
              katalog={yerelKatalog}
              duzenle={duzenle}
              kapat={() => setDuzenle(false)}
              go={go}
              data={{ orders: veri(orders), shipping: veri(shipping), production: veri(production), stock: veri(stock), subcontract: veri(subcontract), finance: veri(finance) }}
              loading={[orders, shipping, production, stock, subcontract, finance].some((r) => r.loading)}
            />
          )}
        </>
      )}
      {facility?.esitleme?.sozlesmeUyarisi ? <Text style={s.note}>{facility.esitleme.sozlesmeUyarisi}</Text> : null}
    </Screen>
  );
}

type Go = (route: string | undefined) => (() => void) | undefined;

/** Fabrikanın pano kutuları: katalog → kullanıcı düzeni → seçili kutuların verisi (tek istek). */
function UzakPano({ go, duzenle, kapat }: { readonly go: Go; readonly duzenle: boolean; readonly kapat: () => void }) {
  const { panocu, scope } = useSession();
  const kat = useRemote("pano:katalog", () => panocu.katalog());
  const katalog = useMemo<PanoKutuTanimi[] | null>(() => (kat.data ? kat.data.kutular.filter((k) => !MOBILDE_YOK.has(k.anahtar)) : null), [kat.data]);
  const duzen = usePanoDuzeni(scope, katalog, DEPO);
  const donem: PanoDonem = (PANO_DONEMLERI as readonly string[]).includes(duzen.donem ?? "") ? (duzen.donem as PanoDonem) : "bugun";
  const keys = duzen.kutular;
  const data = useRemote(duzen.hazir && keys.length > 0 ? `pano:${donem}:${keys.join(",")}` : null, () => panocu.veri(keys, donem));
  const byKey = new Map((katalog ?? []).map((k) => [k.anahtar, k]));
  const donemli = keys.some((k) => byKey.get(k)?.donemli);

  if (!katalog) return kat.error ? <ErrorState text={`Pano yüklenemedi: ${kat.error}`} onRetry={kat.reload} testID="pano-hata" /> : <LoadingSkeleton variant="kpi" rows={4} testID="pano-yukleniyor" />;
  return (
    <>
      {donemli ? (
        <View style={{ marginBottom: space.m }}>
          <SegmentedControl items={PANO_DONEMLERI.map((k) => ({ key: k, label: DONEM_LABEL[k] }))} value={donem} onChange={duzen.setDonem} testIDPrefix="pano-donem-" accessibilityLabel="Dönem" />
        </View>
      ) : null}
      {keys.length === 0 ? <Empty text="Panoda kutu yok — sağ üstteki düzenle düğmesiyle ekleyin" testID="pano-bos" /> : null}
      {data.loading && !data.data ? <LoadingSkeleton variant="kpi" rows={Math.min(keys.length, 4)} testID="pano-yukleniyor" /> : null}
      {data.data ? (
        <KpiGrid testID="pano-kpi">
          {keys.map((k) => {
            const t = byKey.get(k);
            const g = kutuGorunum(k, data.data!.kutular[k]);
            const meta = KUTU_META[k];
            return (
              <KpiCard
                key={k}
                label={t?.baslik ?? k}
                value={g ? g.value ?? "" : "—"}
                unit={g?.unit}
                caption={g ? g.caption : "Veri yok"}
                trend={g?.trend}
                lines={g?.lines}
                domain={meta?.domain ?? "genel"}
                icon={meta?.icon}
                onPress={go(meta?.route)}
                testID={`kutu-${k}`}
              />
            );
          })}
        </KpiGrid>
      ) : null}
      <PanoDuzenleyici visible={duzenle} onClose={kapat} katalog={katalog} duzen={duzen} />
    </>
  );
}

interface YerelVeri {
  readonly orders: unknown;
  readonly shipping: unknown;
  readonly production: unknown;
  readonly stock: unknown;
  readonly subcontract: unknown;
  readonly finance: unknown;
}

/** Eski fabrika / bulut: anlık özetlerden yerel kutular, aynı düzenleyiciyle. */
function YerelPano({ katalog, duzenle, kapat, go, data, loading }: { readonly katalog: readonly KatalogKutusu[]; readonly duzenle: boolean; readonly kapat: () => void; readonly go: Go; readonly data: YerelVeri; readonly loading: boolean }) {
  const { scope } = useSession();
  const duzen = usePanoDuzeni(scope ?? null, katalog, DEPO);
  const tiles = duzen.kutular.map((k) => yerelKutu(k, data, go)).filter((p): p is KpiCardProps => p !== null);
  return (
    <>
      {tiles.length === 0 && loading ? <LoadingSkeleton variant="kpi" rows={4} testID="pano-yukleniyor" /> : null}
      {tiles.length === 0 && !loading && duzen.kutular.length === 0 ? <Empty text="Panoda kutu yok — sağ üstteki düzenle düğmesiyle ekleyin" testID="pano-bos" /> : null}
      {tiles.length > 0 ? (
        <KpiGrid testID="pano-kpi">
          {tiles.map((p) => <KpiCard key={p.testID} {...p} />)}
        </KpiGrid>
      ) : null}
      <PanoDuzenleyici visible={duzenle} onClose={kapat} katalog={katalog} duzen={duzen} />
    </>
  );
}

/** Yerel kutu → kart; verisi henüz gelmemiş kutu çizilmez. */
function yerelKutu(key: string, d: YerelVeri, go: Go): KpiCardProps | null {
  switch (key) {
    case "kahraman": {
      if (d.production === undefined) return null;
      const month = period(d.shipping, "buAy");
      const lines = [
        d.shipping !== undefined ? { label: "Ay sevk", value: `${qty(month.sevkMiktari)} ${UNIT.metre}` } : null,
        d.orders !== undefined ? { label: "Karşılanma", value: pct(obj(d.orders).karsilanmaYuzde) } : null,
      ].filter((l): l is { label: string; value: string } => l !== null);
      return { label: "Bugün üretim", value: qty(obj(d.production).bugunTamamlananToplam), unit: UNIT.top, caption: "istasyonlarda biten", domain: "uretim", icon: "today-outline", lines, onPress: go("/uretim"), testID: "pano-kahraman" };
    }
    case "bugunSevk": {
      if (d.shipping === undefined) return null;
      const today = period(d.shipping, "bugun");
      return {
        label: "Bugün sevk", value: qty(today.sevkMiktari), unit: UNIT.metre, caption: `${qty(today.sevkTopSayisi)} ${UNIT.top} · brüt`, domain: "sevkiyat",
        lines: [{ label: PERIOD_LABEL.buAy, value: `${qty(period(d.shipping, "buAy").sevkMiktari)} ${UNIT.metre}` }],
        onPress: go("/sevkiyat"), testID: "kpi-bugun-sevk",
      };
    }
    case "acikSiparis": {
      if (d.orders === undefined) return null;
      const o = obj(d.orders);
      const late = typeof o.gecikenKalem === "number" && o.gecikenKalem > 0;
      return {
        label: "Açık sipariş", value: qty(o.acikKalem), unit: UNIT.kalem, caption: `${pct(o.karsilanmaYuzde)} karşılandı`, domain: "siparisler",
        lines: [{ label: "Geciken", value: `${qty(o.gecikenKalem)} ${UNIT.kalem}`, tone: late ? "kritik" : undefined }],
        onPress: go("/siparisler"), testID: "kpi-acik-siparis",
      };
    }
    case "vade": {
      if (d.finance === undefined) return null;
      const soon = dueRows(d.finance, ["SOON"]);
      const overdue = dueRows(d.finance, ["OVERDUE"]);
      const first = soon[0];
      return {
        label: "Vadesi yaklaşan", value: first ? dueAmount(first) : "Yok", caption: first ? `${dueShort(first)} · 7 gün` : "7 gün içinde yok", domain: "finans", icon: "calendar-outline",
        status: overdue.length > 0 ? { kind: "kritik", label: "Geçmiş var" } : undefined,
        lines: soon.slice(1, 3).map((r) => ({ label: dueShort(r), value: dueAmount(r) })), lineLayout: "stack", onPress: go("/finans"), testID: "kpi-vade",
      };
    }
    case "kuyruk": {
      if (d.production === undefined) return null;
      const semi = column(d.production, "yariMamul");
      const lines = [column(d.production, "fason"), column(d.production, "depo")].flatMap((c) => (c ? [{ label: c.label, value: `${qty(c.count)} ${UNIT.top}` }] : []));
      return { label: "Üretim kuyruğu", value: qty(semi?.count), unit: UNIT.top, caption: semi ? semi.label : "Akış verisi yok", domain: "uretim", icon: "layers-outline", lines, onPress: go("/uretim"), testID: "kpi-uretim-kuyrugu" };
    }
    case "stok":
      return d.stock === undefined ? null : { label: "Stok", value: "", caption: areaSummary("ozet.stok", d.stock), domain: "stok", onPress: go("/stok"), testID: "kpi-stok" };
    case "fason":
      return d.subcontract === undefined ? null : { label: "Fason", value: "", caption: areaSummary("ozet.fason", d.subcontract), domain: "fason", onPress: go("/uretim"), testID: "kpi-fason" };
    default:
      return null;
  }
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
  intro: { ...typography.callout, color: t.textSecondary, marginTop: space.s },
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.m },
}));
