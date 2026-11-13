// Ürünler (V5c, yalnız ERP): arama ve tür süzgeci sunucuda (`LIST_SEARCH.urun`); satır ad · kod · tür. Dokununca
// düzenleme (oradan fiyatlar); düzenleme kapalı, fiyat açıksa doğrudan fiyatlar.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { islemVar } from "../../../src/api/yetenek";
import { urunTuruEtiketi } from "../../../src/lib/urun";
import { asObj, str } from "../../../src/ui/siparis/OrderRow";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { useDebounced } from "../../../src/ui/Picker";
import { CapsuleButton, ListStates, SearchField, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { space } from "../../../src/ui/tokens";

export default function Items() {
  const { permissions, offline } = useSession();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const ara = useDebounced(term.trim(), 300);
  const list = useRemoteList("urun", { ara: ara || undefined });
  const fiyat = islemVar("fiyat.yaz", permissions);
  const ekle = islemVar("urun.ekle", permissions);
  const duzenle = islemVar("urun.duzenle", permissions);
  return (
    <Screen module="urunler" onRefresh={list.reload} refreshing={list.refreshing} subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}
      headerRight={ekle ? <CapsuleButton label="Yeni ürün" icon="add" disabled={offline} onPress={() => router.push("/urunler/yeni")} testID="yeni-urun" /> : undefined}
    >
      <View style={{ marginBottom: space.m }}>
        <SearchField value={term} onChangeText={setTerm} placeholder="Ad ya da kod ara" testID="urun-ara" />
      </View>
      {list.items.length > 0 ? (
        <ListGroup testID="urun-listesi">
          {list.items.map((r) => {
            const k = asObj(r.kayit);
            const ad = str(k.ad) ?? "—";
            return (
              <ListRow
                key={r.id} title={ad} subtitle={[str(k.kod), urunTuruEtiketi(str(k.tur))].filter(Boolean).join(" · ") || undefined}
                icon="cube-outline" domain="stok" value={k.aktif === false ? "Pasif" : undefined} testID={`urun-${r.id}`}
                onPress={duzenle ? () => router.push({ pathname: "/urunler/duzenle", params: { id: r.id } } as never)
                  : fiyat ? () => router.push({ pathname: "/urunler/fiyat", params: { id: r.id, ad } } as never) : undefined}
              />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={ara ? "Eşleşen ürün yok" : "Ürün yok"} domain="stok" icon={ara ? EMPTY_ICON.arama : undefined} testID="urunler" />
    </Screen>
  );
}
