// Siparişler (teal): fabrika özeti (açık · geciken · açık metre · karşılanma) + durum süzgeci (SUNUCUDA, `durum`)
// + sipariş satırları. "Yeni sipariş" yalnız yazma izniyle ve çevrimiçiyken. Arama yok: `LIST_SEARCH`te sipariş yok.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { can } from "../../../../src/lib/access";
import { formatNumber } from "../../../../src/lib/format";
import { ORDER_STATUS, ORDER_STATUS_ORDER, type OrderStatus } from "../../../../src/lib/labels/siparis";
import { useSession } from "../../../../src/state/session";
import { useRemote } from "../../../../src/state/useRemote";
import { FilterChip } from "../../../../src/ui/FilterChip";
import { Screen } from "../../../../src/ui/Frame";
import { KpiCard } from "../../../../src/ui/KpiCard";
import { ListGroup } from "../../../../src/ui/ListRow";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { openRecord } from "../../../../src/ui/nav";
import { ChoiceSheet } from "../../../../src/ui/siparis/ChoiceSheet";
import { OrderRow, asObj } from "../../../../src/ui/siparis/OrderRow";
import { CapsuleButton, ListStates, StaleNote } from "../../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../../src/ui/siparis/useRemoteList";
import { space } from "../../../../src/ui/tokens";

type DurumKey = OrderStatus | "tumu";
const CHOICES = [{ key: "tumu" as DurumKey, label: "Tümü" }, ...ORDER_STATUS_ORDER.map((k) => ({ key: k as DurumKey, label: ORDER_STATUS[k].label }))];

function Summary({ veri }: { veri: unknown }) {
  const v = asObj(veri);
  const late = Number(v.gecikenKalem) > 0;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m, marginBottom: space.s }} testID="siparis-ozet">
      <KpiCard label="Açık kalem" value={formatNumber(v.acikKalem, 0)} unit="kalem" domain="siparisler" icon="receipt-outline" testID="ozet-acik" />
      <KpiCard
        label="Geciken" value={formatNumber(v.gecikenKalem, 0)} unit="kalem" domain="siparisler" icon="alarm-outline" testID="ozet-geciken"
        status={late ? { kind: "kritik", label: "Gecikme var" } : { kind: "iyi", label: "Gecikme yok" }}
      />
      <KpiCard label="Açık miktar" value={formatNumber(v.acikMiktar, 0)} unit="m" domain="siparisler" icon="resize-outline" testID="ozet-miktar" />
      <KpiCard label="Karşılanma" value={formatNumber(v.karsilanmaYuzde, 0)} unit="%" domain="siparisler" icon="checkmark-done-outline" testID="ozet-karsilanma" />
    </View>
  );
}

export default function Orders() {
  const { api, permissions, offline } = useSession();
  const router = useRouter();
  const [durum, setDurum] = useState<DurumKey>("tumu");
  const [sheet, setSheet] = useState(false);
  const list = useRemoteList("siparis", { durum: durum === "tumu" ? undefined : durum });
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
      <SectionHeader title={durum === "tumu" ? "Tüm siparişler" : ORDER_STATUS[durum].label} domain="siparisler" count={!list.loading && !list.hasMore ? list.items.length : undefined} />
      <View style={{ flexDirection: "row", marginBottom: space.m }}>
        <FilterChip label="Durum" value={CHOICES.find((c) => c.key === durum)?.label ?? "Tümü"} selected={durum !== "tumu"} onPress={() => setSheet(true)} testID="suzgec-durum" />
      </View>
      {list.items.length > 0 ? (
        <ListGroup testID="siparis-listesi">
          {list.items.map((r) => <OrderRow key={r.id} r={r} onPress={() => openRecord(router, "siparis", r.id)} />)}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={durum === "tumu" ? "Henüz sipariş yok" : "Bu durumda sipariş yok"} domain="siparisler" testID="siparisler" />
      <ChoiceSheet visible={sheet} title="Durum" choices={CHOICES} value={durum} onSelect={setDurum} onClose={() => setSheet(false)} testIDPrefix="durum-" />
    </Screen>
  );
}
