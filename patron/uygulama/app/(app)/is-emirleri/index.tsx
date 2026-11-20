// İş emirleri — "hangi iş nerede, kimin": arama (no · müşteri · sipariş no) + Açık/Kapalı + aşama çipleri, süzme SUNUCUDA
// (`LIST_SEARCH["is-emri"]`, üyelik `asama`). Üretim/Fason/sipariş ekranından gelen konum (aşama · fason firma · müşteri ·
// sipariş) rota parametresidir, çiple kaldırılır; konumdayken satır o aşamanın top · metresini yazar (fabrikanın sayısı).
// Sunucu üyelik süzgecini beyan etmediyse (eski sunucu) aşama/firma süzgeci gizlenir, not düşülür.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ListMemberFilterKey } from "../../../src/api/wire";
import { FIRM_FILTER, isStage, listRowText, memberQuery, STAGE_CHIPS, STAGE_LABEL, type Kayit } from "../../../src/lib/is-emri";
import { FilterChip } from "../../../src/ui/FilterChip";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { openRecord } from "../../../src/ui/nav";
import { useDebounced } from "../../../src/ui/Picker";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { useListCapability } from "../../../src/ui/siparis/capabilities";
import { ListStates, QuickChip, SearchField, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";
import { TERIM } from "../../../src/lib/terim";
import { isEmriSutunlari } from "../../../src/ui/tablo/sutunlar";
import { useTabloTercihi } from "../../../src/ui/tablo/useTabloTercihi";
import { TabloAraclari, VeriTablosu } from "../../../src/ui/tablo/VeriTablosu";

type Param = { asama?: string; firma?: string; firmaAdi?: string; cariKartId?: string; musteri?: string; siparisId?: string; siparisNo?: string };

const kayit = (v: unknown): Kayit => (typeof v === "object" && v !== null ? (v as Kayit) : {});

export default function WorkOrders() {
  const router = useRouter();
  const s = useStyles();
  const p = useLocalSearchParams<Param>();
  const cap = useListCapability();
  const search = cap.search("is-emri");
  const [term, setTerm] = useState("");
  const [durum, setDurum] = useState<string | null>(search?.suzgec?.varsayilan ?? null);
  const ara = useDebounced(term.trim(), 300);
  const can = (k: ListMemberFilterKey) => cap.memberFilter("is-emri", k);
  const asama = isStage(p.asama) && can("asama") ? p.asama : null;
  const firma = p.firma && can(FIRM_FILTER) ? p.firma : undefined;
  const cari = p.cariKartId && can("cariKartId") ? p.cariKartId : undefined;
  const siparis = p.siparisId && can("siparisId") ? p.siparisId : undefined;
  // Firma konumunda aşama "fason"dur (top o firmada); başka aşama süzgeci verilmez.
  const stage = firma ? "fason" : asama;
  // Sıralama ve görünen sütunlar (D7): sunucu beyan ettiyse; tercih bulutta hesap başına, ERP kipinde cihazda.
  const sutunlar = useMemo(isEmriSutunlari, []);
  const tablo = useTabloTercihi("tablo.is-emri", "is-emri", sutunlar);
  const list = useRemoteList("is-emri", {
    ...(tablo.tercih.sirala ? { sirala: tablo.tercih.sirala, yon: tablo.tercih.yon } : {}),
    ...(search ? { ara: ara || undefined, suzgec: durum ?? undefined } : {}),
    uyelik: memberQuery({ asama, firma, cari, siparis }),
  });
  const set = (patch: Partial<Param>) => router.setParams(patch as never);
  const chips = [
    firma ? { key: "firma", label: "Fason", value: p.firmaAdi ?? "Seçili firma", clear: () => set({ firma: undefined, firmaAdi: undefined }) } : null,
    cari ? { key: "cari", label: "Müşteri", value: p.musteri ?? "Seçili", clear: () => set({ cariKartId: undefined, musteri: undefined }) } : null,
    siparis ? { key: "siparis", label: "Sipariş", value: p.siparisNo ?? "Seçili", clear: () => set({ siparisId: undefined, siparisNo: undefined }) } : null,
  ].filter((x) => x !== null);
  const title = firma ? (p.firmaAdi ?? "Fasonda") : asama ? STAGE_LABEL[asama]! : undefined;
  const ignored = (p.asama && !asama) || (p.firma && !firma);
  const filtered = !!ara || chips.length > 0 || !!asama;

  return (
    <Screen title={title} module="is-emirleri" back={!!title || undefined} onRefresh={list.reload} refreshing={list.refreshing} subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}>
      {!list.closed ? (
        <View style={s.tools}>
          {search ? <SearchField value={term} onChangeText={setTerm} placeholder={`${TERIM.terbiyeIsEmri.tekil} no, müşteri ya da sipariş no ara`} testID="is-emri-ara" /> : null}
          {search?.suzgec ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} testID="is-emri-durum">
              {search.suzgec.secenekler.map((o) => <QuickChip key={o.deger} label={o.etiket} selected={durum === o.deger} onPress={() => setDurum(durum === o.deger ? null : o.deger)} testID={`durum-${o.deger}`} />)}
            </ScrollView>
          ) : null}
          {can("asama") && !firma ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} testID="is-emri-asama">
              <QuickChip label="Her yerde" selected={!asama} onPress={() => set({ asama: undefined })} testID="asama-tumu" />
              {STAGE_CHIPS.map((a) => <QuickChip key={a} label={STAGE_LABEL[a]!} selected={asama === a} onPress={() => set({ asama: a })} testID={`asama-${a}`} />)}
            </ScrollView>
          ) : null}
          {chips.length > 0 ? (
            <View style={s.wrap}>
              {chips.map((c) => <FilterChip key={c.key} label={c.label} value={`${c.value}  ✕`} selected onPress={c.clear} testID={`is-emri-cip-${c.key}`} />)}
            </View>
          ) : null}
          {ignored ? <Text style={s.note} testID="is-emri-suzgec-yok">Sunucu bu konum süzgecini henüz tanımıyor; bütün {TERIM.terbiyeIsEmri.cogulKucuk} gösteriliyor.</Text> : null}
        </View>
      ) : null}
      {list.closed ? null : <SectionHeader title={stage ? `Bu konumdaki ${TERIM.terbiyeIsEmri.cogulKucuk}` : TERIM.terbiyeIsEmri.cogul} domain="uretim" count={!list.loading && !list.hasMore ? list.items.length : undefined} />}
      {!list.closed ? <View style={s.tools}><TabloAraclari sutunlar={sutunlar} durum={tablo} testID="is-emri-tablo" /></View> : null}
      {list.items.length > 0 ? (
        <VeriTablosu
          sutunlar={sutunlar}
          kayitlar={list.items}
          durum={tablo}
          onPress={(r) => openRecord(router, "is-emri", r.id)}
          testID="is-emri-tablo"
          kart={(items) => (
            <ListGroup testID="is-emri-listesi">
              {items.map((r) => {
                const x = listRowText(kayit(r.kayit), stage);
                return <ListRow key={r.id} title={x.title} value={x.value} lines={x.lines} domain="uretim" icon="clipboard-outline" onPress={() => openRecord(router, "is-emri", r.id)} testID={`is-emri-${r.id}`} />;
              })}
            </ListGroup>
          )}
        />
      ) : null}
      <ListStates list={list} empty={filtered ? `Bu süzgeçte ${TERIM.terbiyeIsEmri.tekilKucuk} yok` : `${TERIM.terbiyeIsEmri.tekil} yok`} domain="uretim" testID="is-emirleri" />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  tools: { gap: space.s, marginBottom: space.m },
  chips: { gap: space.s },
  wrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.s },
  note: { ...typography.footnote, color: t.textSecondary },
}));
