// "Diğer" bölümünün küçük görsel parçaları: baş harf avatarı (rol renginde), sayaç kapsülü, gruplu liste üstü küçük
// başlık (iOS Ayarlar), ikonlu aç/kapa satırı. Renkler `useTokens()`tan; ham hex yok.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { IconChip } from "../IconChip";
import type { IconName } from "../icons";
import { roleOf } from "../RoleBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, tabularNums, typography, type Domain } from "../tokens";

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  // Türkçe i/ı elle eşlenir (Hermes ICU yerel ayarına güvenilmez).
  return `${first}${last}`.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

/** Baş harf avatarı: yönetici navy + altın, ekip indigo zemin. */
export function Avatar({ name, permissions, size = 44 }: { readonly name: string | null | undefined; readonly permissions: readonly string[]; readonly size?: number }) {
  const t = useTokens();
  const role = roleOf(permissions);
  const c = t.role[role];
  // Koyu temada lacivert zemin yüzeyle birleşir; yönetici avatarı altın halkayla ayrılır.
  const ring = role === "yonetici" && t.scheme === "dark" ? { borderWidth: 1.5, borderColor: t.gold } : null;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }, ring]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ color: c.fg, fontSize: Math.round(size * 0.38), fontWeight: "700" }} maxFontSizeMultiplier={1}>{initials(name)}</Text>
    </View>
  );
}

/** Sayaç kapsülü (ör. bekleyen mesaj sayısı). */
export function CountPill({ value, testID, tone = "tint" }: { readonly value: string; readonly testID?: string; readonly tone?: "tint" | "uyari" }) {
  const t = useTokens();
  const s = useStyles();
  const bg = tone === "uyari" ? t.status.uyari.bg : t.tint;
  const fg = tone === "uyari" ? t.status.uyari.text : t.onTint;
  return (
    <View style={[s.pill, { backgroundColor: bg }]} testID={testID}>
      <Text style={[s.pillText, { color: fg }]} maxFontSizeMultiplier={FONT_SCALE.title}>{value}</Text>
    </View>
  );
}

/** Gruplu liste üstündeki küçük gri başlık (bölüm başlığından hafif). */
export function GroupCaption({ children, right }: { readonly children: string; readonly right?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.captionRow}>
      <Text style={s.caption} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

/** Gruplu listede açıklayıcı dipnot. */
export function GroupNote({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const s = useStyles();
  return <Text style={s.note} testID={testID}>{children}</Text>;
}

/** İkonlu aç/kapa satırı (ListGroup içinde). `testID` anahtara verilir (testler `props.disabled` okur). */
export function ToggleRow(p: {
  readonly label: string;
  readonly hint?: string;
  readonly value: boolean;
  readonly onChange: (v: boolean) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
  readonly icon?: IconName;
  readonly domain?: Domain;
}) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={s.toggle}>
      {p.icon ? <View style={p.disabled ? s.dim : null}><IconChip domain={p.domain ?? "genel"} icon={p.icon} size={32} /></View> : null}
      <View style={s.flex}>
        <Text style={[s.toggleLabel, p.disabled && { color: t.textMuted }]}>{p.label}</Text>
        {p.hint ? <Text style={s.toggleHint}>{p.hint}</Text> : null}
      </View>
      <Switch
        value={p.value}
        onValueChange={p.onChange}
        disabled={p.disabled}
        testID={p.testID}
        accessibilityLabel={p.label}
        trackColor={{ true: t.status.iyi.fill, false: t.separator }}
        thumbColor={t.paper}
      />
    </View>
  );
}

/** Seçim satırı (radyo/onay kutusu görünümü) — şablon ve izin listeleri. */
export function CheckRow(p: {
  readonly title: string;
  readonly subtitle?: string;
  readonly checked: boolean;
  readonly onPress: () => void;
  readonly kind?: "checkbox" | "radio";
  readonly icon?: IconName;
  readonly domain?: Domain;
  readonly disabled?: boolean;
  readonly testID?: string;
  readonly right?: ReactNode;
}) {
  const t = useTokens();
  const s = useStyles();
  const radio = p.kind === "radio";
  const mark: IconName = radio ? (p.checked ? "radio-button-on" : "radio-button-off") : p.checked ? "checkbox" : "square-outline";
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "checkbox"}
      accessibilityState={{ checked: p.checked, disabled: !!p.disabled }}
      accessibilityLabel={[p.title, p.subtitle].filter(Boolean).join(", ")}
      disabled={p.disabled}
      onPress={p.onPress}
      testID={p.testID}
      style={({ pressed }) => [s.check, pressed && { backgroundColor: t.surfaceAlt }]}
    >
      {p.icon ? <IconChip domain={p.domain ?? "genel"} icon={p.icon} size={32} /> : null}
      <View style={s.flex}>
        <Text style={s.toggleLabel}>{p.title}</Text>
        {p.subtitle ? <Text style={s.toggleHint}>{p.subtitle}</Text> : null}
      </View>
      {p.right}
      <Ionicons name={mark} size={24} color={p.checked ? t.tint : t.textMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  pill: { minWidth: 24, height: 24, borderRadius: radius.chip, paddingHorizontal: space.s, alignItems: "center" as const, justifyContent: "center" as const },
  pillText: { ...typography.footnote, ...tabularNums, fontWeight: "700" as const },
  captionRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, justifyContent: "space-between" as const, paddingHorizontal: space.l, marginTop: space.m, marginBottom: space.s },
  caption: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary },
  note: { ...typography.footnote, color: t.textMuted, paddingHorizontal: space.l, marginTop: -space.xs, marginBottom: space.m },
  toggle: { minHeight: 56, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  check: { minHeight: TOUCH + 8, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  toggleLabel: { ...typography.callout, fontWeight: "500" as const, color: t.text },
  toggleHint: { ...typography.footnote, color: t.textSecondary, marginTop: 1 },
}));
