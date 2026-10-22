// Rapor ekranı parçaları: katalog kartı (alan renkli ikon çipi), durum rozeti (+ hesaplanırken nabız), parametre
// satırları ve hazır görünüm kartı. Başlık/durum sözlükten (`labels/finans`); sayılar fabrikanın, uygulama hesaplamaz.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { REPORT_PARAM, REPORT_STATUS, reportDomain } from "../../lib/labels/finans";
import { humanize, isHiddenKey } from "../../lib/present";
import type { Remote } from "../../state/useRemote";
import { SnapshotView } from "../data";
import { IconChip } from "../IconChip";
import type { IconName } from "../icons";
import { Card } from "../kit";
import { StatusBadge } from "../StatusBadge";
import { ErrorState, LoadingSkeleton } from "../StateViews";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, tabularNums, typography, type Domain, type StatusKind } from "../tokens";

/** Rapor isteği durumu rozeti; HESAPLANIYOR'da yanında küçük dönen gösterge. Etiket ve ton sözlükten. */
/** `compact`: liste satırında dönen gösterge yok (başlık sığsın; rozet durumu zaten söyler). */
export function ReportStatusBadge({ status, testID, compact }: { status: string; testID?: string; compact?: boolean }) {
  const t = useTokens();
  const e = (REPORT_STATUS as Readonly<Record<string, { label: string; tone: StatusKind } | undefined>>)[status];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      {status === "HESAPLANIYOR" && !compact ? <ActivityIndicator size="small" color={t.status.bilgi.fill} accessibilityLabel="Hesaplanıyor" /> : null}
      {e ? <StatusBadge kind={e.tone} label={e.label} size="sm" testID={testID} /> : <StatusBadge value={status} size="sm" testID={testID} />}
    </View>
  );
}

/** Katalog kartı: alan renkli ikon çipi + başlık + fabrikanın "soru"su. */
export function ReportTile({ anahtar, baslik, soru, onPress }: { anahtar: string; baslik: string; soru?: string; onPress: () => void }) {
  const t = useTokens();
  const s = useStyles();
  const d = reportDomain(anahtar);
  return (
    <Pressable
      onPress={onPress}
      testID={`katalog-${anahtar}`}
      accessibilityRole="button"
      accessibilityLabel={`${baslik} raporu iste`}
      style={({ pressed }) => [s.tile, pressed && s.pressed]}
    >
      <View style={s.tileHead}>
        <IconChip domain={d.domain} icon={d.icon} size={36} />
        <Ionicons name="add-circle-outline" size={20} color={t.tint} />
      </View>
      <Text style={s.tileTitle} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.title}>{baslik}</Text>
      {soru ? <Text style={s.tileSub} numberOfLines={3}>{soru}</Text> : null}
    </Pressable>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T/;

/** Parametre değeri: takvim günü/anı tarih olarak, gerisi olduğu gibi. */
export function paramValue(v: unknown): string {
  if (typeof v === "string") return DAY.test(v) ? formatDate(v) : INSTANT.test(v) ? formatDateTime(v) : v;
  if (typeof v === "number") return formatNumber(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  return "—";
}

/** İstek parametrelerinin kısa özeti ("01.09.2026 – 29.09.2026"); boşsa "Varsayılan dönem". */
export function paramSummary(params: unknown): string {
  const p = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  if (p.dateFrom !== undefined || p.dateTo !== undefined) {
    const a = paramValue(p.dateFrom);
    const b = paramValue(p.dateTo);
    // Aynı yıl tek kez yazılır (telefon satırında rozetin yanına sığsın): "01.09 – 30.09.2026".
    const same = /^\d{2}\.\d{2}\.(\d{4})$/.exec(a)?.[1];
    return same !== undefined && b.endsWith(`.${same}`) && b.length === 10 ? `${a.slice(0, 5)} – ${b}` : `${a} – ${b}`;
  }
  if (p.asOf !== undefined) return `Kesit ${paramValue(p.asOf)}`;
  return Object.keys(p).length === 0 ? "Varsayılan dönem" : `${Object.keys(p).length} parametre`;
}

/** Parametre satırları (ad sözlükten, yoksa okunur hâle getirilir). */
export function ParamRows({ params }: { params: unknown }) {
  const s = useStyles();
  const entries = Object.entries(typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {}).filter(([k]) => !isHiddenKey(k));
  if (entries.length === 0) return <Text style={s.rowLabel}>Raporun varsayılan dönemi</Text>;
  return (
    <View>
      {entries.map(([k, v], i) => (
        <View key={k} style={[s.row, i > 0 && s.sep]} accessible accessibilityLabel={`${REPORT_PARAM[k] ?? humanize(k)}: ${paramValue(v)}`}>
          <Text style={s.rowLabel}>{REPORT_PARAM[k] ?? humanize(k)}</Text>
          <Text style={s.rowValue}>{paramValue(v)}</Text>
        </View>
      ))}
    </View>
  );
}

export interface ReadyStat {
  readonly label: string;
  readonly value: string;
  readonly tone?: StatusKind;
}

/** Hazır görünüm (fabrikanın hesapladığı anlık): başlık + 3 öne çıkan sayı; "Ayrıntı" tüm dökümü açar. */
export function ReadyView<T extends { veri: unknown }>(p: {
  projection: string;
  title: string;
  domain: Domain;
  icon: IconName;
  remote: Remote<T>;
  stats: (veri: unknown) => readonly ReadyStat[];
}) {
  const t = useTokens();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const r = p.remote;
  return (
    <Card domain={p.domain} testID={`anlik-${p.projection}`}>
      <View style={s.readyHead}>
        <IconChip domain={p.domain} icon={p.icon} />
        <Text style={s.readyTitle} maxFontSizeMultiplier={FONT_SCALE.title}>{p.title}</Text>
      </View>
      {r.loading && !r.data ? <LoadingSkeleton variant="kpi" rows={3} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <View>
          <View style={s.stats}>
            {p.stats(r.data.veri).map((x) => (
              <View key={x.label} style={[s.stat, x.tone ? { backgroundColor: t.status[x.tone].bg } : null]} accessible accessibilityLabel={`${x.label}: ${x.value}`}>
                <Text style={[s.statLabel, x.tone ? { color: t.status[x.tone].text } : null]} numberOfLines={2}>{x.label}</Text>
                <Text style={[s.statValue, x.tone ? { color: t.status[x.tone].text } : null]} numberOfLines={2} adjustsFontSizeToFit>{x.value}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={() => setOpen((o) => !o)} style={s.more} accessibilityRole="button" testID={`anlik-${p.projection}-ayrinti`}>
            <Text style={s.moreText}>{open ? "Ayrıntıyı gizle" : "Ayrıntı"}</Text>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.tint} />
          </Pressable>
          {open ? <SnapshotView value={r.data.veri} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: 132,
    backgroundColor: t.surface,
    borderRadius: radius.card,
    padding: space.l,
    gap: space.s,
    ...t.cardShadow,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  tileHead: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "flex-start" as const },
  tileTitle: { ...typography.headline, color: t.text },
  tileSub: { ...typography.footnote, color: t.textSecondary },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: space.m, paddingVertical: space.s + 2 },
  sep: { borderTopWidth: 1, borderTopColor: t.separator },
  rowLabel: { ...typography.subhead, color: t.textSecondary },
  rowValue: { ...typography.callout, ...tabularNums, color: t.text, flexShrink: 1, textAlign: "right" as const },
  readyHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginBottom: space.m },
  readyTitle: { ...typography.headline, color: t.text, flex: 1 },
  stats: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.s },
  stat: { flexGrow: 1, flexBasis: 132, backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, padding: space.m },
  statLabel: { ...typography.caption, color: t.textSecondary },
  statValue: { ...typography.title2, ...tabularNums, color: t.text, marginTop: space.xs },
  more: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, alignSelf: "flex-start" as const },
  moreText: { ...typography.subhead, color: t.tint },
}));
