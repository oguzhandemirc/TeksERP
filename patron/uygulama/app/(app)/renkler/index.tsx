// Renkler (V5c, yalnız ERP): arama sunucuda (`LIST_SEARCH.renk`); satır ad · kod, pasif rozet. Dokununca düzenleme.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { islemVar } from "../../../src/api/yetenek";
import { asObj, str } from "../../../src/ui/siparis/OrderRow";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { useDebounced } from "../../../src/ui/Picker";
import { CapsuleButton, ListStates, SearchField, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { space } from "../../../src/ui/tokens";

export default function Colors() {
  const { permissions, offline } = useSession();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const ara = useDebounced(term.trim(), 300);
  const list = useRemoteList("renk", { ara: ara || undefined });
  const ekle = islemVar("renk.ekle", permissions);
  const duzenle = islemVar("renk.duzenle", permissions);
  return (
    <Screen
      module="renkler" onRefresh={list.reload} refreshing={list.refreshing}
      subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}
      headerRight={ekle ? <CapsuleButton label="Yeni renk" icon="add" disabled={offline} onPress={() => router.push("/renkler/yeni")} testID="yeni-renk" /> : undefined}
    >
      <View style={{ marginBottom: space.m }}>
        <SearchField value={term} onChangeText={setTerm} placeholder="Ad ya da kod ara" testID="renk-ara" />
      </View>
      {list.items.length > 0 ? (
        <ListGroup testID="renk-listesi">
          {list.items.map((r) => {
            const k = asObj(r.kayit);
            return (
              <ListRow
                key={r.id} title={str(k.ad) ?? "—"} subtitle={str(k.kod) ?? undefined} icon="color-palette-outline" domain="uretim"
                value={k.aktif === false ? "Pasif" : undefined} testID={`renk-${r.id}`}
                onPress={duzenle ? () => router.push({ pathname: "/renkler/duzenle", params: { id: r.id } } as never) : undefined}
              />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={ara ? "Eşleşen renk yok" : "Renk yok"} domain="uretim" icon={ara ? EMPTY_ICON.arama : undefined} testID="renkler" />
    </Screen>
  );
}
