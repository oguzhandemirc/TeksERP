// Hesap satırı: baş harf avatarı (rol renginde) · ad · rol + durum rozeti yan yana · e-posta + son giriş.
// Rol ölçütü `roleOf` (`bulut:hesap:yonet` → Yönetici); yalnız gösterir, karar sunucudadır.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import type { Account } from "../../api/wire";
import { formatAgo } from "../../lib/format";
import { statusEntry } from "../../lib/labels";
import type { IconName } from "../icons";
import { ROLE_LABEL, RoleBadge, roleOf } from "../RoleBadge";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, typography } from "../tokens";
import { Avatar } from "./parts";

export function lastSeen(a: Pick<Account, "sonGiris" | "durum" | "davetBitis">): string {
  if (a.sonGiris) return `Son giriş ${formatAgo(a.sonGiris)}`;
  return a.durum === "DAVETLI" ? "Daveti henüz kabul etmedi" : "Henüz giriş yapmadı";
}

export function AccountRow({ a, onPress }: { readonly a: Account; readonly onPress: () => void }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      testID={`hesap-${a.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${a.ad}, ${ROLE_LABEL[roleOf(a.izinler)]}, ${statusEntry(a.durum).label}`}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}
    >
      <Avatar name={a.ad} permissions={a.izinler} size={44} />
      <View style={s.text}>
        <Text style={s.name} numberOfLines={1}>{a.ad}</Text>
        <View style={s.badges}>
          <RoleBadge permissions={a.izinler} testID={`hesap-rol-${a.id}`} />
          <StatusBadge value={a.durum} size="sm" />
        </View>
        <Text style={s.mail} numberOfLines={1}>{a.eposta}</Text>
        <Text style={s.seen} numberOfLines={2}>{lastSeen(a)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

/** Kapsül eylem düğmesi (ör. "Davet et"): yuvarlak, tint dolgulu, ikonlu. */
export function Capsule({ label, icon, onPress, disabled, testID }: { readonly label: string; readonly icon: IconName; readonly onPress: () => void; readonly disabled?: boolean; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [s.capsule, { backgroundColor: t.tint }, disabled && s.off, pressed && s.pressed]}
    >
      <Ionicons name={icon} size={18} color={t.onTint} />
      <Text style={[s.capsuleText, { color: t.onTint }]} maxFontSizeMultiplier={FONT_SCALE.title}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 76, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, minWidth: 0 },
  name: { ...typography.headline, color: t.text },
  badges: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, flexWrap: "wrap" as const, marginTop: space.xs },
  mail: { ...typography.subhead, color: t.textSecondary, marginTop: space.xs },
  seen: { ...typography.footnote, color: t.textMuted, marginTop: 1 },
  capsule: { minHeight: TOUCH - 4, flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, paddingHorizontal: space.l, borderRadius: radius.chip, alignSelf: "flex-start" as const },
  capsuleText: { ...typography.callout, fontWeight: "600" as const },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
