// Anlık kapısı: yükleniyor → iskelet · hata → "Tekrar dene" · veri yok → ikonlu boş · veri → içerik.
// 404 hata DEĞİLDİR: fabrika anlığı henüz yayınlamadı (ya da eski fabrika üretmiyor) → aynı boş durum (D4-KUC3c).
// Bayat (önbellek) veri çizilir; üstüne "Fabrika verisi HH:MM" damgası `FactoryStamp` ile ayrıca basılır.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { Snapshot } from "../../api/wire";
import { formatFactory } from "../../lib/factory-time";
import type { Remote } from "../../state/useRemote";
import { Empty, ErrorState, LoadingSkeleton } from "../StateViews";
import { makeStyles, useTokens } from "../theme-context";
import { space, typography, type Domain } from "../tokens";
import { EMPTY_ICON } from "../icons";

export function SnapshotGate({ remote, domain, variant = "kpi", rows, empty, children, testID }: {
  readonly remote: Remote<Snapshot>;
  readonly domain: Domain;
  readonly variant?: "kpi" | "list";
  readonly rows?: number;
  readonly empty?: string;
  readonly children: (veri: unknown, snap: Snapshot) => ReactNode;
  readonly testID?: string;
}) {
  if (remote.data) return <View testID={testID}>{children(remote.data.veri, remote.data)}</View>;
  if (remote.loading) return <LoadingSkeleton variant={variant} rows={rows ?? (variant === "kpi" ? 2 : 3)} testID={testID ? `${testID}-yukleniyor` : undefined} />;
  if (remote.error && !remote.notFound) return <ErrorState text={remote.error} onRetry={remote.reload} testID={testID ? `${testID}-hata` : undefined} />;
  return <Empty text={empty ?? "Fabrikadan bu özet henüz gelmedi"} domain={domain} icon={EMPTY_ICON.bekliyor} testID={testID ? `${testID}-bos` : undefined} />;
}

/** "Fabrika verisi 14:05" — anlığın sürümü (fabrikanın veri anı), tesis diliminde; çevrimdışıysa ayrıca söyler. */
export function FactoryStamp({ snap, offline, note, testID }: { readonly snap: Snapshot | null | undefined; readonly offline?: boolean; readonly note?: string; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  if (!snap) return null;
  const at = formatFactory(snap.surum, "HH:mm", "");
  if (!at) return null;
  const text = `Fabrika verisi ${at}${note ? ` · ${note}` : ""}${offline ? " · çevrimdışı" : ""}`;
  return (
    <View style={s.row} testID={testID} accessible accessibilityLabel={text}>
      <Ionicons name="time-outline" size={13} color={t.textSecondary} />
      <Text style={s.text}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, marginBottom: space.s },
  text: { ...typography.footnote, color: t.textSecondary },
}));
