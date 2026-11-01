// Finans › Kasa: kasa hareketleri listesi + kategori süzgeci (D4-KUC3c; DALGA4 §9.8). Süzme SUNUCUDA, fabrikanın
// `kategoriAnahtari` eşitliğiyle; seçenekler `ozet-masraf` anlığının anahtarlı kategorileri. Eski sunucu süzgeci
// bilmez (yetenek yok) → çip yok; eski fabrika anahtar göndermez → "fabrika güncellenince gelir".
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { cashCategoryOptions, type CashCategoryOption } from "../../lib/expense-summary";
import { ProjectionList } from "../data";
import { FilterChip } from "../FilterChip";
import { haptic } from "../haptics";
import { openRecord } from "../nav";
import { useSnapshot } from "../pano/useSnapshot";
import { SectionHeader } from "../SectionHeader";
import { useListCapability } from "../siparis/capabilities";
import { makeStyles, useTokens } from "../theme-context";
import { radius, space, TOUCH, typography } from "../tokens";
import { kasaHareketiRow } from "./rows";

const PROJECTION = "kasa-hareketi";
export const CASH_CATEGORY_LATER = "Kategori süzgeci fabrika güncellenince gelir";

export function CashTransactions({ category, onCategory }: { readonly category: string | null; readonly onCategory: (key: string | null) => void }) {
  const router = useRouter();
  const s = useStyles();
  const filterable = useListCapability().keyFilter(PROJECTION, "kategoriAnahtari");
  const summary = useSnapshot("ozet-masraf", filterable);
  const { options, legacy } = summary.data ? cashCategoryOptions(summary.data.veri) : { options: [], legacy: false };
  const active = filterable ? category : null;
  const later = filterable && (legacy || !!summary.notFound);
  return (
    <View>
      <SectionHeader title="Kasa hareketleri" domain="finans" />
      {filterable && (options.length !== 0 || active !== null) ? <CategoryFilter options={options} value={active} onChange={onCategory} /> : null}
      {later ? <Text style={s.note} testID="kasa-kategori-sonra">{CASH_CATEGORY_LATER}</Text> : null}
      <ProjectionList
        projection={PROJECTION}
        row={kasaHareketiRow}
        domain="finans"
        filter={active !== null ? { kategoriAnahtari: active } : undefined}
        empty={active !== null ? "Bu kategoride kasa hareketi yok" : "Kasa hareketi yok"}
        onOpen={(r) => openRecord(router, PROJECTION, r.id)}
      />
    </View>
  );
}

/** "Kategori: Tümü" çipi — dokununca seçenekler satır içi açılır (seçici emsali `Picker` FilterDropdown). */
function CategoryFilter(p: { options: readonly CashCategoryOption[]; value: string | null; onChange: (key: string | null) => void }) {
  const t = useTokens();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const all: readonly { key: string | null; label: string }[] = [{ key: null, label: "Tümü" }, ...p.options];
  // Masraf segmentinden gelen anahtar listede yoksa (özet tazelenmedi) yine süzülür; anahtar ayrıştırılmaz.
  const current = p.value === null ? "Tümü" : (p.options.find((o) => o.key === p.value)?.label ?? "Seçili kategori");
  return (
    <View style={s.filter}>
      <FilterChip label="Kategori" value={current} selected={p.value !== null} onPress={() => setOpen((x) => !x)} testID="kasa-kategori" />
      {open ? (
        <View style={s.options}>
          {all.map((o, i) => {
            const on = o.key === p.value;
            return (
              <Pressable key={o.key ?? "_tumu"} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`kasa-kategori-${o.key ?? "tumu"}`}
                onPress={() => { haptic("selection"); p.onChange(o.key); setOpen(false); }}
                style={({ pressed }) => [s.option, i !== 0 && s.optionSep, pressed && { backgroundColor: t.surfaceAlt }]}>
                <Text style={[s.optionText, on && { color: t.tint, fontWeight: "600" }]} numberOfLines={1}>{o.label}</Text>
                {on ? <Ionicons name="checkmark" size={18} color={t.tint} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  filter: { marginBottom: space.m },
  options: { marginTop: space.s, borderRadius: radius.cardInner, backgroundColor: t.surface, borderWidth: 1, borderColor: t.separator, overflow: "hidden" as const },
  option: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: space.l, gap: space.s },
  optionSep: { borderTopWidth: 1, borderTopColor: t.separator },
  optionText: { ...typography.body, color: t.text, flex: 1 },
  note: { ...typography.footnote, color: t.textMuted, marginBottom: space.s },
}));
