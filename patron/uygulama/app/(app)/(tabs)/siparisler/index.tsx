// Siparişler (teal): fabrika özeti (açık · geciken · açık metre · karşılanma) + arama ve görünüm çipleri (SUNUCUDA,
// `ara` + `suzgec`, `LIST_SEARCH.siparis`) + sipariş satırları. Sunucu sipariş aramasını beyan etmiyorsa (eski bulut)
// arama gizlenir, tek "Durum" süzgeci (`durum`) kalır. "Yeni sipariş" yalnız yazma izniyle ve çevrimiçiyken.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { ListSearchSpec } from "../../../../src/api/wire";
import { can } from "../../../../src/lib/access";
import { formatNumber } from "../../../../src/lib/format";
import { ORDER_STATUS, ORDER_STATUS_ORDER, type OrderStatus } from "../../../../src/lib/labels/siparis";
import { useSession } from "../../../../src/state/session";
import { useRemote } from "../../../../src/state/useRemote";
import { FilterChip } from "../../../../src/ui/FilterChip";
import { useDebounced } from "../../../../src/ui/Picker";
import { Screen } from "../../../../src/ui/Frame";
import { KpiCard, KpiGrid } from "../../../../src/ui/KpiCard";
import { ListGroup } from "../../../../src/ui/ListRow";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { openRecord } from "../../../../src/ui/nav";
import { ChoiceSheet } from "../../../../src/ui/siparis/ChoiceSheet";
import { OrderRow, asObj } from "../../../../src/ui/siparis/OrderRow";
import { useListCapability } from "../../../../src/ui/siparis/capabilities";
import { CapsuleButton, ListStates, QuickChip, SearchField, StaleNote } from "../../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../../src/ui/siparis/useRemoteList";
import { space } from "../../../../src/ui/tokens";

type DurumKey = OrderStatus | "tumu";
const CHOICES = [{ key: "tumu" as DurumKey, label: "Tümü" }, ...ORDER_STATUS_ORDER.map((k) => ({ key: k as DurumKey, label: ORDER_STATUS[k].label }))];

function Summary({ veri }: { veri: unknown }) {
  const v = asObj(veri);
  const late = Number(v.gecikenKalem) > 0;
  return (
    <KpiGrid testID="siparis-ozet">
      <KpiCard label="Açık kalem" value={formatNumber(v.acikKalem, 0)} unit="kalem" domain="siparisler" icon="receipt-outline" testID="ozet-acik" />
      <KpiCard
        label="Geciken" value={formatNumber(v.gecikenKalem, 0)} unit="kalem" domain="siparisler" icon="alarm-outline" testID="ozet-geciken"
        status={late ? { kind: "kritik", label: "Gecikme var" } : { kind: "iyi", label: "Gecikme yok" }}
      />
      <KpiCard label="Açık miktar" value={formatNumber(v.acikMiktar, 0)} unit="m" domain="siparisler" icon="resize-outline" testID="ozet-miktar" />
      <KpiCard label="Karşılanma" value={formatNumber(v.karsilanmaYuzde, 0)} unit="%" domain="siparisler" icon="checkmark-done-outline" testID="ozet-karsilanma" />
    </KpiGrid>
  );
}

/** Görünüm çipleri sunucu beyanından (`LIST_SEARCH.siparis.suzgec`): tek seçim, "Tümü" süzgeci kaldırır. */
function ViewChips({ spec, value, onChange }: { spec: NonNullable<ListSearchSpec["suzgec"]>; value: string | null; onChange: (v: string | null) => void }) {
  const options = [{ deger: null as string | null, etiket: "Tümü" }, ...spec.secenekler];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} testID="siparis-cipleri" accessibilityLabel={spec.etiket}>
      {options.map((o) => (
        <QuickChip key={o.deger ?? "_tumu"} label={o.etiket} selected={value === o.deger} onPress={() => onChange(o.deger)} testID={`cip-${o.deger ?? "tumu"}`} />
      ))}
    </ScrollView>
  );
}

export default function Orders() {
  const { api, permissions, offline } = useSession();
  const router = useRouter();
  const search = useListCapability().search("siparis");
  const [durum, setDurum] = useState<DurumKey>("tumu");
  const [sheet, setSheet] = useState(false);
  const [term, setTerm] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const ara = useDebounced(term.trim(), 300);
  const list = useRemoteList(
    "siparis",
    search ? { ara: ara || undefined, suzgec: chip ?? undefined } : { durum: durum === "tumu" ? undefined : durum },
  );
  const chipLabel = search?.suzgec?.secenekler.find((o) => o.deger === chip)?.etiket ?? null;
  const title = search ? (chipLabel ?? "Tüm siparişler") : durum === "tumu" ? "Tüm siparişler" : ORDER_STATUS[durum].label;
  const filtered = search ? !!ara || chip !== null : durum !== "tumu";
  const canWrite = can(permissions, "bulut:siparis:yaz");
  const summary = useRemote(can(permissions, "bulut:ozet:oku") ? "anlik:ozet.siparis" : null, () => api.snapshot("ozet.siparis"), { tags: ["ozet", "ozet.siparis"] });
  const refresh = () => {
    list.reload();
    summary.reload();
  };
  return (
    <Screen
      title="Siparişler" module="siparisler" back={false}
      onRefresh={refresh} refreshing={list.refreshing || summary.refreshing}
      subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}
      headerRight={canWrite ? <CapsuleButton label="Yeni sipariş" icon="add" disabled={offline} onPress={() => router.push("/siparisler/yeni")} testID="yeni-siparis" /> : undefined}
    >
      {summary.data ? <Summary veri={summary.data.veri} /> : null}
      <SectionHeader title={title} domain="siparisler" count={!list.loading && !list.hasMore ? list.items.length : undefined} />
      {search ? (
        <View style={{ gap: space.s, marginBottom: space.m }}>
          <SearchField value={term} onChangeText={setTerm} placeholder="Sipariş no ya da müşteri ara" testID="siparis-ara" />
          {search.suzgec ? <ViewChips spec={search.suzgec} value={chip} onChange={setChip} /> : null}
        </View>
      ) : (
        <View style={{ flexDirection: "row", marginBottom: space.m }}>
          <FilterChip label="Durum" value={CHOICES.find((c) => c.key === durum)?.label ?? "Tümü"} selected={durum !== "tumu"} onPress={() => setSheet(true)} testID="suzgec-durum" />
        </View>
      )}
      {list.items.length > 0 ? (
        <ListGroup testID="siparis-listesi">
          {list.items.map((r) => <OrderRow key={r.id} r={r} onPress={() => openRecord(router, "siparis", r.id)} />)}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={filtered ? "Bu süzgeçte sipariş yok" : "Henüz sipariş yok"} domain="siparisler" testID="siparisler" />
      <ChoiceSheet visible={sheet} title="Durum" choices={CHOICES} value={durum} onSelect={setDurum} onClose={() => setSheet(false)} testIDPrefix="durum-" />
    </Screen>
  );
}
