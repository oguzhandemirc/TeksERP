// Seçici: dokununca DOĞRUDAN tam liste sayfası açılır — kaydırılabilir liste + arama + tek açılır süzgeç.
// Arama ve süzgeç SUNUCUDA (`LIST_SEARCH`); istemci listeyi süzmez. "Daha fazla" aynı terimle devam eder.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LIST_SEARCH, type ListSearchSpec } from "../api/wire";
import { recordSubtitle, recordTitle } from "../lib/present";
import { FilterChip } from "./FilterChip";
import { haptic } from "./haptics";
import { ListGroup, ListRow } from "./ListRow";
import { ListStates, SearchField } from "./siparis/parts";
import { useRemoteList } from "./siparis/useRemoteList";
import { makeStyles, useTokens } from "./theme-context";
import { EMPTY_ICON, type IconName } from "./icons";
import { FONT_SCALE, READABLE_MAX, TOUCH, radius, space, typography, type Domain } from "./tokens";

export interface Picked {
  readonly id: string;
  readonly title: string;
}

const ARAMA_BEKLEME_MS = 300;

/** Seçici satırının alan ikonu (cari gül, ürün taş, renk paleti). */
function rowIcon(projection: string): { domain: Domain; icon: IconName } {
  if (projection === "cari-kart") return { domain: "cariler", icon: "person-outline" };
  if (projection === "urun") return { domain: "stok", icon: "cube-outline" };
  if (projection === "renk") return { domain: "uretim", icon: "color-palette-outline" };
  return { domain: "genel", icon: "ellipse-outline" };
}

/** Yazım durunca terimi bırakır (her tuşta istek gitmesin). */
export function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** Tek açılır süzgeç: "Rol: Müşteri" çipi — dokununca seçenekler (Tümü dahil) satır içi açılır. */
function FilterDropdown(p: { spec: NonNullable<ListSearchSpec["suzgec"]>; value: string | null; onChange: (v: string | null) => void }) {
  const t = useTokens();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const options = [{ deger: null as string | null, etiket: "Tümü" }, ...p.spec.secenekler];
  const current = options.find((o) => o.deger === p.value)?.etiket ?? "Tümü";
  return (
    <View style={s.filter}>
      <FilterChip label={p.spec.etiket} value={current} selected={p.value !== null} onPress={() => setOpen((x) => !x)} testID="secici-suzgec" />
      {open ? (
        <View style={s.options}>
          {options.map((o, i) => {
            const on = o.deger === p.value;
            return (
              <Pressable key={o.deger ?? "_tumu"} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`secici-suzgec-${o.deger ?? "tumu"}`}
                onPress={() => { haptic("selection"); p.onChange(o.deger); setOpen(false); }}
                style={({ pressed }) => [s.option, i > 0 && s.optionSep, pressed && { backgroundColor: t.surfaceAlt }]}>
                <Text style={[s.optionText, on && { color: t.tint, fontWeight: "600" }]}>{o.etiket}</Text>
                {on ? <Ionicons name="checkmark" size={18} color={t.tint} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function Sheet(p: { label: string; projection: string; spec: ListSearchSpec | undefined; optional?: boolean; value: Picked | null; onPick: (v: Picked | null) => void; onClose: () => void }) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<string | null>(p.spec?.suzgec?.varsayilan ?? null);
  const ara = useDebounced(term.trim(), ARAMA_BEKLEME_MS);
  const list = useRemoteList(p.projection, { ara: ara || undefined, suzgec: filter ?? undefined });
  return (
    <View style={[s.sheet, { paddingTop: Math.max(insets.top, space.m) }]}>
      <View style={s.inner}>
        <View style={s.head}>
          <Pressable onPress={p.onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kapat" testID="secici-kapat" style={s.headBtn}>
            <Text style={s.headBtnText}>Kapat</Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>{`${p.label} seç`}</Text>
          {p.optional && p.value ? (
            <Pressable onPress={() => p.onPick(null)} hitSlop={8} accessibilityRole="button" testID="secici-temizle" style={[s.headBtn, s.headRight]}>
              <Text style={[s.headBtnText, { color: t.status.kritik.fill }]}>Temizle</Text>
            </Pressable>
          ) : <View style={s.headBtn} />}
        </View>
        {p.spec ? (
          <View style={s.tools}>
            <SearchField value={term} onChangeText={setTerm} placeholder="Ad ya da kod ara" testID="secici-ara" accessibilityLabel={`${p.label} ara`} />
            {p.spec.suzgec ? <FilterDropdown spec={p.spec.suzgec} value={filter} onChange={setFilter} /> : null}
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={[s.inner, s.listPad, { paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        {list.items.length > 0 ? (
          <ListGroup>
            {list.items.map((r) => {
              const title = recordTitle(r.kayit);
              const on = r.id === p.value?.id;
              return (
                <ListRow key={r.id} testID={`kayit-${r.id}`} title={title} subtitle={recordSubtitle(r.kayit) || undefined} {...rowIcon(p.projection)}
                  accessory={on ? <Ionicons name="checkmark-circle" size={22} color={t.tint} /> : undefined}
                  onPress={() => p.onPick({ id: r.id, title })} />
              );
            })}
          </ListGroup>
        ) : null}
        <ListStates list={list} empty={ara ? "Eşleşen kayıt yok" : "Kayıt yok"} domain="genel" icon={ara ? EMPTY_ICON.arama : undefined} />
      </ScrollView>
    </View>
  );
}

export function Picker(p: { label: string; projection: string; value: Picked | null; onChange: (v: Picked | null) => void; optional?: boolean; testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const spec = Object.prototype.hasOwnProperty.call(LIST_SEARCH, p.projection) ? LIST_SEARCH[p.projection] : undefined;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{p.label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${p.label}: ${p.value?.title ?? "seçilmedi"}`} testID={p.testID} onPress={() => setOpen(true)}
        style={({ pressed }) => [s.trigger, pressed && { backgroundColor: t.surfaceAlt }]}>
        <Text style={[s.triggerText, { color: p.value ? t.text : t.textMuted }]} numberOfLines={1}>
          {p.value?.title ?? (p.optional ? "Seçilmedi (isteğe bağlı)" : "Seçin")}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        {open ? <Sheet label={p.label} projection={p.projection} spec={spec} optional={p.optional} value={p.value} onClose={close} onPick={(v) => { p.onChange(v); close(); }} /> : null}
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  field: { marginBottom: space.m },
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginBottom: space.xs },
  trigger: {
    minHeight: TOUCH,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.s,
    paddingHorizontal: space.m,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: t.separator,
    backgroundColor: t.surface,
  },
  triggerText: { ...typography.body, flex: 1 },
  sheet: { flex: 1, backgroundColor: t.bg },
  inner: { width: "100%" as const, maxWidth: READABLE_MAX, alignSelf: "center" as const, paddingHorizontal: space.l },
  head: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const },
  headBtn: { minWidth: 72, minHeight: TOUCH, justifyContent: "center" as const },
  headRight: { alignItems: "flex-end" as const },
  headBtnText: { ...typography.body, color: t.tint },
  title: { ...typography.headline, color: t.text, flex: 1, textAlign: "center" as const },
  tools: { gap: space.s, paddingBottom: space.s },
  filter: { gap: space.xs },
  options: { backgroundColor: t.surface, borderRadius: radius.cardInner, overflow: "hidden" as const, ...t.cardShadow },
  option: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: space.l },
  optionSep: { borderTopWidth: 1, borderTopColor: t.separator },
  optionText: { ...typography.body, color: t.text, flex: 1 },
  listPad: { paddingTop: space.s },
}));
