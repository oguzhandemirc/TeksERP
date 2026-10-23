// Kayıt durumu rozeti: dört durum tonu kit `StatusBadge`ine gider; "etkin" (marka, oynat ikonu), "notr" (saat),
// "sonuk" (gri, kapanmış/iptal) burada çizilir. Ton eşlemesinin tek kaynağı `lib/labels/uretim.ts`.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import type { RecordStatusEntry, RecordTone } from "../../lib/labels/uretim";
import type { IconName } from "../icons";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, radius, space, typography, type Tokens } from "../tokens";

type LocalTone = Exclude<RecordTone, "iyi" | "uyari" | "kritik" | "bilgi">;

function palette(t: Tokens, tone: LocalTone): { readonly bg: string; readonly fg: string; readonly text: string; readonly icon: IconName } {
  if (tone === "etkin") return { bg: t.tintContainer, fg: t.tint, text: t.tint, icon: "play-circle" };
  if (tone === "notr") return { bg: t.status.bilgi.bg, fg: t.status.bilgi.fill, text: t.status.bilgi.text, icon: "time-outline" };
  return { bg: t.separator, fg: t.textMuted, text: t.textMuted, icon: "remove-circle-outline" };
}

export function RecordStatusBadge({ entry, testID }: { readonly entry: RecordStatusEntry; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const tone = entry.tone;
  if (tone === "iyi" || tone === "uyari" || tone === "kritik" || tone === "bilgi") {
    return <StatusBadge kind={tone} label={entry.label} size="sm" testID={testID} />;
  }
  const c = palette(t, tone);
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]} testID={testID} accessible accessibilityLabel={`Durum: ${entry.label}`}>
      <Ionicons name={c.icon} size={12} color={c.fg} />
      <Text style={[s.text, { color: c.text }]} maxFontSizeMultiplier={FONT_SCALE.title}>{entry.label}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xs,
    alignSelf: "flex-start" as const,
    borderRadius: radius.chip,
    paddingHorizontal: space.s,
    paddingVertical: 2,
  },
  text: { ...typography.footnote, fontWeight: "600" as const },
}));
