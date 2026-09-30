// Seçici: dokununca DOĞRUDAN tam liste modalı açılır — kaydırılabilir liste + arama + tek açılır süzgeç.
// Arama ve süzgeç SUNUCUDA (`LIST_SEARCH`); istemci listeyi süzmez. "Daha fazla" aynı terimle devam eder.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ARAMA_AZAMI, LIST_SEARCH, type ListSearchSpec } from "../api/wire";
import { recordTitle } from "../lib/present";
import { ProjectionList } from "./data";
import { Button } from "./kit";
import { TOUCH, color, space } from "./theme";

export interface Picked {
  readonly id: string;
  readonly title: string;
}

const ARAMA_BEKLEME_MS = 300;

/** Yazım durunca terimi bırakır (her tuşta istek gitmesin). */
export function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** Tek açılır süzgeç: "Rol: Müşteri ▾" — dokununca seçenekler (Tümü dahil) açılır. */
function FilterDropdown(p: { spec: NonNullable<ListSearchSpec["suzgec"]>; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const options = [{ deger: null as string | null, etiket: "Tümü" }, ...p.spec.secenekler];
  const current = options.find((o) => o.deger === p.value)?.etiket ?? "Tümü";
  return (
    <View style={{ marginTop: space.s }}>
      <Pressable accessibilityRole="button" testID="secici-suzgec" onPress={() => setOpen((x) => !x)}
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: color.line, borderRadius: 8, justifyContent: "center", paddingHorizontal: space.m, backgroundColor: color.card }}>
        <Text style={{ fontSize: 16, color: color.text }}>{`${p.spec.etiket}: ${current} ${open ? "▴" : "▾"}`}</Text>
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: color.line, borderRadius: 8, marginTop: space.xs, backgroundColor: color.card }}>
          {options.map((o) => (
            <Pressable key={o.deger ?? "_tumu"} accessibilityRole="button" testID={`secici-suzgec-${o.deger ?? "tumu"}`}
              onPress={() => { p.onChange(o.deger); setOpen(false); }}
              style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.m }}>
              <Text style={{ fontSize: 16, fontWeight: o.deger === p.value ? "700" : "400" }}>{o.etiket}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Picker(p: { label: string; projection: string; value: Picked | null; onChange: (v: Picked | null) => void; optional?: boolean; testID?: string }) {
  const spec = Object.prototype.hasOwnProperty.call(LIST_SEARCH, p.projection) ? LIST_SEARCH[p.projection] : undefined;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<string | null>(spec?.suzgec?.varsayilan ?? null);
  const ara = useDebounced(term.trim(), ARAMA_BEKLEME_MS);
  const close = () => setOpen(false);
  return (
    <View style={{ marginBottom: space.m }}>
      <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: space.xs }}>{p.label}</Text>
      <Pressable accessibilityRole="button" testID={p.testID} onPress={() => setOpen(true)}
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: color.line, borderRadius: 8, justifyContent: "center", paddingHorizontal: space.m, backgroundColor: color.card }}>
        <Text style={{ fontSize: 16, color: p.value ? color.text : color.muted }}>{p.value?.title ?? (p.optional ? "Seçilmedi (isteğe bağlı)" : "Seçin")}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: color.bg, paddingTop: space.xl }}>
          <View style={{ flexDirection: "row", paddingHorizontal: space.l, gap: space.s }}>
            <View style={{ flex: 1 }}><Button label="Kapat" tone="plain" onPress={close} /></View>
            {p.optional && p.value ? <View style={{ flex: 1 }}><Button label="Temizle" tone="plain" onPress={() => { p.onChange(null); close(); }} /></View> : null}
          </View>
          {spec ? (
            <View style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
              <TextInput value={term} onChangeText={setTerm} placeholder="Ad ya da kod ara" placeholderTextColor={color.muted}
                maxLength={ARAMA_AZAMI} autoCorrect={false} autoCapitalize="none" testID="secici-ara" accessibilityLabel={`${p.label} ara`}
                style={{ minHeight: TOUCH, borderWidth: 1, borderColor: color.line, borderRadius: 8, paddingHorizontal: space.m, fontSize: 16, backgroundColor: color.card, color: color.text }} />
              {spec.suzgec ? <FilterDropdown spec={spec.suzgec} value={filter} onChange={setFilter} /> : null}
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: space.l }} keyboardShouldPersistTaps="handled">
            <ProjectionList projection={p.projection} compact empty={ara ? "Eşleşen kayıt yok" : "Kayıt yok"}
              filter={{ ara: ara || undefined, suzgec: filter ?? undefined }}
              onOpen={(r) => { p.onChange({ id: r.id, title: recordTitle(r.kayit) }); close(); }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
