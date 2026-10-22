// Siparişler + Cariler ekranlarının ortak parçaları: arama alanı, kapsül düğme, liste altlığı, bilgi satırı, rol rozeti.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ARAMA_AZAMI } from "../../api/wire";
import { fmtFactoryTime } from "../../lib/factory-time";
import { formatAgo } from "../../lib/format";
import type { IconName } from "../icons";
import { Button } from "../kit";
import { Empty, ErrorState, LoadingSkeleton } from "../StateViews";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, tabularNums, typography, type Domain, type StatusKind } from "../tokens";
import type { RemoteList } from "./useRemoteList";

export function SearchField(p: { value: string; onChangeText: (v: string) => void; placeholder: string; testID?: string; accessibilityLabel?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={s.search}>
      <Ionicons name="search" size={18} color={t.textMuted} />
      <TextInput
        value={p.value}
        onChangeText={p.onChangeText}
        placeholder={p.placeholder}
        placeholderTextColor={t.textMuted}
        maxLength={ARAMA_AZAMI}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        testID={p.testID}
        accessibilityLabel={p.accessibilityLabel ?? p.placeholder}
        style={s.searchInput}
      />
      {p.value ? (
        <Pressable onPress={() => p.onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
          <Ionicons name="close-circle" size={18} color={t.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Kapsül eylem düğmesi (başlık sağ yuvası / satır içi): tint zemin, ikon + kısa etiket. */
export function CapsuleButton(p: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean; testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      testID={p.testID}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: !!p.disabled }}
      hitSlop={6}
      style={({ pressed }) => [s.capsule, p.disabled && s.capsuleOff, pressed && { opacity: 0.85 }]}
    >
      {p.icon ? <Ionicons name={p.icon} size={16} color={t.onTint} /> : null}
      <Text style={s.capsuleText} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title}>{p.label}</Text>
    </Pressable>
  );
}

/** Liste altlığı: iskelet · hata + tekrar dene · tasarlanmış boş durum · "Daha fazla". */
export function ListStates(p: { list: RemoteList; empty: string; domain: Domain; icon?: IconName; testID?: string }) {
  const { list } = p;
  if (list.loading) return <LoadingSkeleton rows={4} testID={p.testID ? `${p.testID}-yukleniyor` : undefined} />;
  return (
    <View>
      {list.error ? <ErrorState text={list.error} onRetry={list.reload} /> : null}
      {!list.error && list.items.length === 0 ? <Empty text={p.empty} domain={p.domain} icon={p.icon} testID={p.testID ? `${p.testID}-bos` : undefined} /> : null}
      {list.loadingMore ? <ActivityIndicator style={{ margin: space.l }} accessibilityLabel="Yükleniyor" /> : list.hasMore ? <Button label="Daha fazla" tone="secondary" icon="chevron-down" onPress={list.loadMore} testID="daha-fazla" /> : null}
    </View>
  );
}

/** "Fabrika verisi HH:MM" — saklı kopya gösteriliyorsa ne zamandan olduğu (bayat ≠ çevrimdışı). */
export function StaleNote({ stale, savedAt }: { stale: boolean; savedAt: string | null }) {
  const s = useStyles();
  if (!stale || !savedAt) return null;
  return (
    <View style={s.stale} testID="fabrika-verisi">
      <Ionicons name="time-outline" size={14} color={s.staleText.color} />
      <Text style={s.staleText}>{`Fabrika verisi ${fmtFactoryTime(savedAt)} · ${formatAgo(savedAt)}`}</Text>
    </View>
  );
}

/** Etiket ↔ değer satırı (ayrıntı kartları); değer durum anlamı taşıyorsa tonlu. */
export function FactRow(p: { label: string; value: string; tone?: StatusKind; accessory?: ReactNode; testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={s.fact} testID={p.testID} accessible accessibilityLabel={`${p.label}: ${p.value}`}>
      <Text style={s.factLabel}>{p.label}</Text>
      <View style={s.factRight}>
        {p.accessory}
        <Text style={[s.factValue, p.tone ? { color: t.status[p.tone].fill } : null]} numberOfLines={2}>{p.value}</Text>
      </View>
    </View>
  );
}

/** Bilgi satırlarını opak kart içinde ince ayraçla toplar. */
export function FactGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const s = useStyles();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={s.group} testID={testID}>
      {items.map((c, i) => (
        <View key={i} style={i > 0 ? s.sepTop : null}>{c}</View>
      ))}
    </View>
  );
}

const ROLE_DOMAIN: Readonly<Record<string, Domain>> = { musteriRolu: "cariler", tedarikciRolu: "stok", fasonRolu: "fason" };

/** Rol rozeti (kimlik ≠ rol): Müşteri gül, Tedarikçi taş, Fason fuşya — renk "hangi rol" der, iyi/kötü değil. */
export function RolePill({ roleKey, label }: { roleKey: string; label: string }) {
  const t = useTokens();
  const s = useStyles();
  const c = t.domain[ROLE_DOMAIN[roleKey] ?? "genel"];
  return (
    <View style={[s.pill, { backgroundColor: c.chip }]} accessible accessibilityLabel={`Rol: ${label}`}>
      <Text style={[s.pillText, { color: c.fg }]} maxFontSizeMultiplier={FONT_SCALE.title}>{label}</Text>
    </View>
  );
}

export const useStyles = makeStyles((t) => ({
  search: {
    minHeight: 44,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.s,
    paddingHorizontal: space.m,
    borderRadius: radius.control,
    backgroundColor: t.scheme === "dark" ? t.surfaceAlt : t.surface,
    borderWidth: 1,
    borderColor: t.separator,
  },
  searchInput: { flex: 1, minHeight: 44, ...typography.body, color: t.text },
  capsule: {
    minHeight: 36,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xs,
    paddingHorizontal: space.m + 2,
    borderRadius: radius.chip,
    backgroundColor: t.tint,
  },
  capsuleOff: { opacity: 0.4 },
  capsuleText: { ...typography.subhead, fontWeight: "600" as const, color: t.onTint },
  stale: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, marginBottom: space.s },
  staleText: { ...typography.footnote, color: t.textMuted },
  group: { backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, marginBottom: space.m, ...t.cardShadow },
  sepTop: { borderTopWidth: 1, borderTopColor: t.separator, marginLeft: space.l },
  fact: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  factLabel: { ...typography.callout, color: t.textSecondary, flexShrink: 0 },
  factRight: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "flex-end" as const, gap: space.s },
  factValue: { ...typography.callout, ...tabularNums, fontWeight: "600" as const, color: t.text, textAlign: "right" as const, flexShrink: 1 },
  pill: { borderRadius: radius.chip, paddingHorizontal: space.s, paddingVertical: 2, alignSelf: "flex-start" as const },
  pillText: { ...typography.caption, fontWeight: "600" as const },
}));
