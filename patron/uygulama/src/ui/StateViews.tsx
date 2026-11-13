// Durum görünümleri: boş · yükleniyor iskeleti · hata · çevrimdışı / salt-okunur / eşitleme gecikti bantları.
// Bantlar `Banner` üstüne kurulur (aynı testID'ler `StatusBands`ta korunur).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { DOMAIN_ICON, type IconName } from "./icons";
import { Banner, Button } from "./kit";
import { durations } from "./motion";
import { makeStyles, useReducedMotion, useTokens } from "./theme-context";
import { radius, space, typography, type Domain } from "./tokens";

export function Empty({ text, domain = "genel", icon, actionLabel, onAction, testID }: {
  readonly text: string;
  readonly domain?: Domain;
  readonly icon?: IconName;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly testID?: string;
}) {
  const t = useTokens();
  const s = useStyles();
  return (
    // Sıkı boş durum: tek satır ikon + metin (bölüm içinde yer kaplamaz); eylem varsa sağda.
    <View style={s.empty} testID={testID}>
      <View style={[s.emptyIcon, { backgroundColor: t.domain[domain].chip }]}>
        <Ionicons name={icon ?? DOMAIN_ICON[domain]} size={18} color={t.domain[domain].fg} />
      </View>
      <Text style={s.emptyText}>{text}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} tone="secondary" onPress={onAction} /> : null}
    </View>
  );
}

/** İskelet: KPI ızgarası ya da liste satırı biçiminde; hareket azaltma açıksa sabit. */
export function LoadingSkeleton({ variant = "list", rows = 3, testID }: { readonly variant?: "kpi" | "list"; readonly rows?: number; readonly testID?: string }) {
  const s = useStyles();
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    o.value = withRepeat(withTiming(0.5, { duration: durations.slower * 2 }), -1, true);
    return () => cancelAnimation(o);
  }, [o, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  const blocks = Array.from({ length: rows }, (_, i) => i);
  return (
    <Animated.View style={[variant === "kpi" ? s.kpiGrid : null, pulse]} testID={testID} accessibilityLabel="Yükleniyor" accessibilityRole="progressbar">
      {blocks.map((i) => (variant === "kpi" ? <View key={i} style={s.kpiBlock} /> : <View key={i} style={s.listBlock} />))}
    </Animated.View>
  );
}

export function ErrorState({ text, onRetry, testID }: { readonly text: string; readonly onRetry?: () => void; readonly testID?: string }) {
  return (
    <View testID={testID}>
      <Banner tone="error" text={text} />
      {onRetry ? <Button label="Tekrar dene" tone="plain" icon="refresh" onPress={onRetry} /> : null}
    </View>
  );
}

export function OfflineBand({ text, testID = "bant-cevrimdisi" }: { readonly text: string; readonly testID?: string }) {
  return <Banner tone="off" icon="cloud-offline-outline" text={text} testID={testID} />;
}

export function ReadOnlyBand({ text, testID = "bant-salt-okunur" }: { readonly text: string; readonly testID?: string }) {
  return <Banner tone="warn" icon="lock-closed-outline" text={text} testID={testID} />;
}

export function SyncLateBand({ text, testID = "bant-gecikme" }: { readonly text: string; readonly testID?: string }) {
  return <Banner tone="warn" icon="time-outline" text={text} testID={testID} />;
}

const useStyles = makeStyles((t) => ({
  empty: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, paddingVertical: space.s, paddingHorizontal: space.m, gap: space.m, borderRadius: radius.cardInner, backgroundColor: t.surface, marginBottom: space.s },
  emptyIcon: { width: 32, height: 32, borderRadius: radius.control, alignItems: "center" as const, justifyContent: "center" as const },
  emptyText: { ...typography.callout, color: t.textSecondary, flex: 1, minWidth: 140 },
  kpiGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.m },
  kpiBlock: { flexGrow: 1, flexBasis: 150, height: 112, borderRadius: radius.card, backgroundColor: t.surfaceAlt },
  listBlock: { height: 56, borderRadius: radius.cardInner, backgroundColor: t.surfaceAlt, marginBottom: space.s },
}));
