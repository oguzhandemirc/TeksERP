// Teklifler: müşteriye GÖNDERİLMİŞ teklifler (taslak buluta gelmez). Arama ve çipler SUNUCUDA (`LIST_SEARCH.teklif`);
// "Süresi doldu" fabrikanın `suresiDoldu`su, tutar yalnız `.finans` (maliyet izni) geldiyse — istemci hesap yapmaz.
import { useRouter } from "expo-router";
import { quoteRowText } from "../../src/ui/teklif/rows";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { recordStatus } from "../../src/lib/labels/uretim";
import { QUOTE_EXPIRED, QUOTE_STATUS } from "../../src/lib/labels/teklif";
import { Screen } from "../../src/ui/Frame";
import { ListGroup, ListRow } from "../../src/ui/ListRow";
import { openRecord } from "../../src/ui/nav";
import { RecordStatusBadge } from "../../src/ui/pano/RecordStatusBadge";
import { SectionHeader } from "../../src/ui/SectionHeader";
import { asObj } from "../../src/ui/siparis/OrderRow";
import { useListCapability } from "../../src/ui/siparis/capabilities";
import { ListStates, QuickChip, SearchField, StaleNote } from "../../src/ui/siparis/parts";
import { useRemoteList } from "../../src/ui/siparis/useRemoteList";
import { useDebounced } from "../../src/ui/Picker";
import { space } from "../../src/ui/tokens";

export default function Quotes() {
  const router = useRouter();
  const search = useListCapability().search("teklif");
  const [term, setTerm] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const ara = useDebounced(term.trim(), 300);
  const list = useRemoteList("teklif", search ? { ara: ara || undefined, suzgec: chip ?? undefined } : {});
  const filtered = !!ara || chip !== null;
  const options = search?.suzgec ? [{ deger: null as string | null, etiket: "Tümü" }, ...search.suzgec.secenekler] : [];
  return (
    <Screen title="Teklifler" module="teklifler" onRefresh={list.reload} refreshing={list.refreshing} subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}>
      {search ? (
        <View style={{ gap: space.s, marginBottom: space.m }}>
          <SearchField value={term} onChangeText={setTerm} placeholder="Teklif no ya da müşteri ara" testID="teklif-ara" />
          {options.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} testID="teklif-cipleri">
              {options.map((o) => (
                <QuickChip key={o.deger ?? "_tumu"} label={o.etiket} selected={chip === o.deger} onPress={() => setChip(o.deger)} testID={`cip-${o.deger ?? "tumu"}`} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      <SectionHeader title="Gönderilen teklifler" domain="siparisler" count={!list.loading && !list.hasMore ? list.items.length : undefined} />
      {list.items.length > 0 ? (
        <ListGroup testID="teklif-listesi">
          {list.items.map((r) => {
            const x = quoteRowText(r);
            const st = x.expired ? QUOTE_EXPIRED : recordStatus(QUOTE_STATUS, asObj(r.kayit).durum);
            return (
              <ListRow
                key={r.id}
                title={x.title}
                value={x.value}
                lines={[x.value ? `${st.label} · ${x.line}` : x.line]}
                accessory={x.value ? undefined : <RecordStatusBadge entry={st} testID={`durum-${r.id}`} />}
                domain="siparisler"
                onPress={() => openRecord(router, "teklif", r.id)}
                testID={`kayit-${r.id}`}
              />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={filtered ? "Bu süzgeçte teklif yok" : "Henüz gönderilmiş teklif yok"} domain="siparisler" testID="teklifler" />
    </Screen>
  );
}
