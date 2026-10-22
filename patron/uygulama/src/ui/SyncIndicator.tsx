// Eşitleme göstergesi: "● 2 dk önce eşitlendi" — iyi: yeşil canlı nokta · gecikti: amber · çevrimdışı: gri bulut.
// Zaman fabrikanın eşitleme damgasıdır; metin + ikon + renk birlikte (yalnız renk değil).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { formatAgo, syncIsLate } from "../lib/format";
import { durations } from "./motion";
import { makeStyles, useReducedMotion, useTokens } from "./theme-context";
import { TOUCH, space, typography, type StatusKind } from "./tokens";

export type SyncState = "canli" | "gecikti" | "cevrimdisi";

export function syncState(last: string | null | undefined, offline: boolean, nowMs: number = Date.now()): SyncState {
  if (offline) return "cevrimdisi";
  return syncIsLate(last, nowMs) ? "gecikti" : "canli";
}

export function syncText(state: SyncState, last: string | null | undefined, nowMs: number = Date.now()): string {
  if (state === "cevrimdisi") return last ? `Çevrimdışı · son veri ${formatAgo(last, nowMs)}` : "Çevrimdışı";
  if (!last) return "Henüz eşitleme yok";
  return `${formatAgo(last, nowMs)} eşitlendi`;
}

const TONE: Readonly<Record<SyncState, StatusKind>> = { canli: "iyi", gecikti: "uyari", cevrimdisi: "bilgi" };

export function SyncIndicator({ last, offline = false, onPress, testID = "esitleme-gostergesi" }: {
  readonly last: string | null | undefined;
  readonly offline?: boolean;
  readonly onPress?: () => void;
  readonly testID?: string;
}) {
  const t = useTokens();
  const s = useStyles();
  const reduced = useReducedMotion();
  const state = syncState(last, offline);
  const color = t.status[TONE[state]].fill;
  const text = syncText(state, last);
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced || state !== "canli") {
      o.value = 1;
      return;
    }
    o.value = withRepeat(withTiming(0.35, { duration: durations.slower * 2 }), -1, true);
    return () => cancelAnimation(o);
  }, [o, reduced, state]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  const body = (
    <View style={s.row}>
      {state === "cevrimdisi" ? (
        <Ionicons name="cloud-offline-outline" size={14} color={color} />
      ) : (
        <Animated.View style={[s.dot, { backgroundColor: color }, pulse]} />
      )}
      <Text style={[s.text, state === "gecikti" ? { color: t.status.uyari.fill } : null]} numberOfLines={1}>{text}</Text>
    </View>
  );
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={`Eşitleme: ${text}`}>{body}</View>;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={`Eşitleme: ${text}. Yenile`} style={s.press}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs + 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...typography.footnote, color: t.textSecondary },
  press: { minHeight: TOUCH, justifyContent: "center" as const },
}));
