// Cariler (gül): arama (sunucu `ara`) + "Rol: Tümü" süzgeci (sunucu `suzgec`, `LIST_SEARCH.cari-kart`) + satırlar
// ad · kod/il · rol rozetleri. Bakiye ayrıntıda (`cari-hesap`, cari kart satırı bakiye taşımaz). İstemci süzmez.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { LIST_SEARCH } from "../../../src/api/wire";
import { can } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { FilterChip } from "../../../src/ui/FilterChip";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup } from "../../../src/ui/ListRow";
import { useDebounced } from "../../../src/ui/Picker";
import { ChoiceSheet } from "../../../src/ui/siparis/ChoiceSheet";
import { CustomerRow } from "../../../src/ui/siparis/CustomerRow";
import { CapsuleButton, ListStates, SearchField, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { space } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";

const SPEC = LIST_SEARCH["cari-kart"]!;
const ROLE_CHOICES = [{ key: "tumu", label: "Tümü" }, ...(SPEC.suzgec?.secenekler ?? []).map((o) => ({ key: o.deger, label: o.etiket }))];

export default function Customers() {
  const { permissions, offline } = useSession();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [rol, setRol] = useState("tumu");
  const [sheet, setSheet] = useState(false);
  const ara = useDebounced(term.trim(), 300);
  const list = useRemoteList("cari-kart", { ara: ara || undefined, suzgec: rol === "tumu" ? undefined : rol });
  const canWrite = can(permissions, "bulut:cari:yaz");
  return (
    <Screen
      title="Cariler" module="cariler"
      onRefresh={list.reload} refreshing={list.refreshing}
      subtitle={<StaleNote stale={list.stale} savedAt={list.savedAt} />}
      headerRight={canWrite ? <CapsuleButton label="Yeni cari" icon="add" disabled={offline} onPress={() => router.push("/cariler/yeni")} testID="yeni-cari" /> : undefined}
    >
      <View style={{ gap: space.s, marginBottom: space.m }}>
        <SearchField value={term} onChangeText={setTerm} placeholder="Ad ya da kod ara" testID="cari-ara" />
        <View style={{ flexDirection: "row" }}>
          <FilterChip label={SPEC.suzgec?.etiket ?? "Rol"} value={ROLE_CHOICES.find((c) => c.key === rol)?.label ?? "Tümü"} selected={rol !== "tumu"} onPress={() => setSheet(true)} testID="suzgec-rol" />
        </View>
      </View>
      {list.items.length > 0 ? (
        <ListGroup testID="cari-listesi">
          {list.items.map((r) => <CustomerRow key={r.id} r={r} onPress={() => router.push({ pathname: "/cariler/[id]", params: { id: r.id } } as never)} />)}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={ara ? "Eşleşen cari yok" : "Cari yok"} domain="cariler" icon={ara ? EMPTY_ICON.arama : undefined} testID="cariler" />
      <ChoiceSheet visible={sheet} title={SPEC.suzgec?.etiket ?? "Rol"} choices={ROLE_CHOICES} value={rol} onSelect={setRol} onClose={() => setSheet(false)} testIDPrefix="rol-" />
    </Screen>
  );
}
