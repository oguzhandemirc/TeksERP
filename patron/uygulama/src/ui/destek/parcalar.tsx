// Destek ekranlarının küçük yapı taşları — uygulamanın mevcut kitinin (`kit.tsx`, `StateViews.tsx`, `SegmentedControl`)
// üstünde ince sarmal; destek dilimi kendi tasarım dilini getirmez, temanın jetonlarını kullanır.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import type { DestekDurumTonu } from "../../destek/metin";
import { Empty, ErrorState } from "../StateViews";
import { SegmentedControl } from "../SegmentedControl";
import type { IconName } from "../icons";
import { makeStyles, useTokens } from "../theme-context";
import { TOUCH, radius, space, typography, type Tokens } from "../tokens";

export type RozetTonu = DestekDurumTonu | "primary";

function rozetRenk(t: Tokens, tone: RozetTonu): { bg: string; fg: string } {
  if (tone === "primary") return { bg: t.tint, fg: t.onTint };
  if (tone === "info") return { bg: t.status.bilgi.bg, fg: t.status.bilgi.text };
  if (tone === "warning") return { bg: t.status.uyari.bg, fg: t.status.uyari.text };
  if (tone === "success") return { bg: t.status.iyi.bg, fg: t.status.iyi.text };
  return { bg: t.surfaceAlt, fg: t.textSecondary };
}

export function Rozet({ label, tone, testID }: { readonly label: string; readonly tone: RozetTonu; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const r = rozetRenk(t, tone);
  return (
    <View style={[s.rozet, { backgroundColor: r.bg }]} testID={testID}>
      <Text style={[s.rozetYazi, { color: r.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function AltSekmeler<K extends string>(p: { readonly sekmeler: readonly { key: K; etiket: string }[]; readonly secili: K; readonly onSec: (k: K) => void; readonly testID?: string }) {
  return (
    <View style={{ marginBottom: space.m }} testID={p.testID}>
      <SegmentedControl items={p.sekmeler.map((x) => ({ key: x.key, label: x.etiket }))} value={p.secili} onChange={p.onSec} testIDPrefix={`${p.testID ?? "sekme"}-`} />
    </View>
  );
}

export function BosDurum(p: { readonly baslik: string; readonly aciklama?: string; readonly icon?: IconName; readonly eylem?: string; readonly onEylem?: () => void; readonly testID?: string }) {
  return <Empty text={p.aciklama ? `${p.baslik}\n${p.aciklama}` : p.baslik} icon={p.icon} actionLabel={p.eylem} onAction={p.onEylem} testID={p.testID} />;
}

export function HataDurumu(p: { readonly mesaj: string; readonly onTekrar?: () => void; readonly ekran?: boolean; readonly testID?: string }) {
  return <ErrorState text={p.mesaj} onRetry={p.onTekrar} testID={p.testID} />;
}

/** Liste kartı (satırlar kenardan kenara, aralarında ayraç). */
export function TamGenislik({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const s = useStyles();
  return <View style={s.kart} testID={testID}>{children}</View>;
}

export function FormKarti({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const s = useStyles();
  return <View style={[s.kart, s.form]} testID={testID}>{children}</View>;
}

export function AlanEtiketi({ children }: { readonly children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.etiket}>{children}</Text>;
}

export function SecimCipi(p: { readonly label: string; readonly on: boolean; readonly rol?: "radio" | "button"; readonly onPress: () => void; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole={p.rol ?? "button"}
      accessibilityState={p.rol === "radio" ? { checked: p.on } : { selected: p.on }}
      testID={p.testID}
      style={({ pressed }) => [s.cip, { backgroundColor: p.on ? t.tintContainer : t.surfaceAlt, borderColor: p.on ? t.tint : t.separator }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[s.cipYazi, { color: p.on ? t.tint : t.text }]}>{p.label}</Text>
    </Pressable>
  );
}

/** Basılınca zemini değişen satır (liste satırı). */
export function Basilabilir({ basiliZemin, style, children, ...rest }: Omit<PressableProps, "style" | "children"> & { readonly basiliZemin?: string; readonly olcek?: number; readonly style?: StyleProp<ViewStyle>; readonly children: ReactNode }) {
  const { olcek: _olcek, ...p } = rest as typeof rest & { olcek?: number };
  return (
    <Pressable {...p} style={({ pressed }) => [style, pressed && basiliZemin ? { backgroundColor: basiliZemin } : null]}>
      {children}
    </Pressable>
  );
}

/** Başlığın sağ yuvasındaki küçük kapsül düğme (ör. "+ Talep"). */
export function KapsulDugme(p: { readonly label: string; readonly erisim?: string; readonly icon?: IconName; readonly onPress: () => void; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable onPress={p.onPress} accessibilityRole="button" accessibilityLabel={p.erisim ?? p.label} testID={p.testID} hitSlop={8} style={({ pressed }) => [s.kapsul, { backgroundColor: t.tintContainer }, pressed && { opacity: 0.7 }]}>
      {p.icon ? <Ionicons name={p.icon} size={16} color={t.tint} /> : null}
      <Text style={[s.kapsulYazi, { color: t.tint }]}>{p.label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  rozet: { borderRadius: radius.chip, paddingHorizontal: space.s, paddingVertical: 2, alignSelf: "flex-start" as const },
  rozetYazi: { ...typography.caption, fontWeight: "600" as const },
  kart: { backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, ...t.cardShadow },
  form: { padding: space.l, gap: space.m },
  etiket: { ...typography.footnote, color: t.textSecondary, fontWeight: "600" as const },
  cip: { minHeight: 36, paddingHorizontal: space.m, borderRadius: radius.chip, borderWidth: 1, justifyContent: "center" as const },
  cipYazi: { ...typography.subhead, fontWeight: "600" as const },
  kapsul: { minHeight: TOUCH - 12, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, paddingHorizontal: space.m, borderRadius: radius.chip },
  kapsulYazi: { ...typography.subhead, fontWeight: "600" as const },
}));
