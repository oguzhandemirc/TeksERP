// Cariler (gül): arama (sunucu `ara`) + "Rol: Tümü" süzgeci (sunucu `suzgec`, `LIST_SEARCH.cari-kart`) + satırlar
// ad · kod/il · rol rozetleri. Bakiye ayrıntıda (`cari-hesap`, cari kart satırı bakiye taşımaz). İstemci süzmez.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { LIST_SEARCH } from "../../../src/api/wire";
import { can } from "../../../src/lib/access";
import { cariRoles } from "../../../src/lib/labels/siparis";
import { useSession } from "../../../src/state/session";
import { FilterChip } from "../../../src/ui/FilterChip";
import { Screen } from "../../../src/ui/Frame";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { useDebounced } from "../../../src/ui/Picker";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { ChoiceSheet } from "../../../src/ui/siparis/ChoiceSheet";
import { asObj, str } from "../../../src/ui/siparis/OrderRow";
import { CapsuleButton, ListStates, RolePill, SearchField, StaleNote } from "../../../src/ui/siparis/parts";
import { useRemoteList } from "../../../src/ui/siparis/useRemoteList";
import { space } from "../../../src/ui/tokens";

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
          {list.items.map((r) => {
            const k = asObj(r.kayit);
            const roles = cariRoles(k);
            const sub = [str(k.kod), str(k.il)].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={r.id} testID={`cari-${r.id}`} domain="cariler" icon={k.aktif === false ? "archive-outline" : "person-outline"}
                title={str(k.ad) ?? "—"} subtitle={sub || undefined}
                accessory={
                  <View style={{ alignItems: "flex-end", gap: space.xs, maxWidth: "45%" }}>
                    {k.aktif === false ? <StatusBadge kind="bilgi" label="Pasif" size="sm" /> : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.xs }}>
                      {roles.map((x) => <RolePill key={x.key} roleKey={x.key} label={x.label} />)}
                    </View>
                  </View>
                }
                accessibilityLabel={[str(k.ad) ?? "—", sub, roles.map((x) => x.label).join(", ")].filter(Boolean).join(", ")}
                onPress={() => router.push({ pathname: "/cariler/[id]", params: { id: r.id } } as never)}
              />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty={ara ? "Eşleşen cari yok" : "Cari yok"} domain="cariler" icon={ara ? "search-outline" : undefined} testID="cariler" />
      <ChoiceSheet visible={sheet} title={SPEC.suzgec?.etiket ?? "Rol"} choices={ROLE_CHOICES} value={rol} onSelect={setRol} onClose={() => setSheet(false)} testIDPrefix="rol-" />
    </Screen>
  );
}
