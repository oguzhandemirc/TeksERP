// Üretim parçaları: akış şeridi (Kanban kolonları, adlar fabrikadan) ve istasyon dağılımı çubukları.
// Çubuk uzunluğu = istasyon kuyruğu / en kalabalık kuyruk (yalnız çizim ölçeği; sayı fabrikanın).
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, Text, View } from "react-native";
import { lookup } from "../../lib/labels";
import { STATION_TYPE, UNIT } from "../../lib/labels/uretim";
import { BarRow } from "../charts";
import { makeStyles, useTokens } from "../theme-context";
import { radius, space, tabularNums, typography } from "../tokens";
import { arr, num, qty, str } from "./read";

/** Akış: Ham stok → Yarı mamul → … → Sevk; her durak top sayısıyla. */
export function FlowStrip({ data, testID = "akis" }: { readonly data: unknown; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const cols = arr((data as { kolonlar?: unknown } | null)?.kolonlar);
  if (cols.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.flow} testID={testID}>
      {cols.map((c, i) => (
        <View key={String(c.anahtar)} style={s.stopWrap}>
          {i > 0 ? <Ionicons name="chevron-forward" size={16} color={t.textMuted} /> : null}
          <View style={s.stop} accessible accessibilityLabel={`${str(c.etiket) ?? String(c.anahtar)}: ${qty(c.adet)} ${UNIT.top}`} testID={`akis-${String(c.anahtar)}`}>
            <Text style={s.stopLabel} numberOfLines={1}>{str(c.etiket) ?? String(c.anahtar)}</Text>
            <View style={s.stopValueRow}>
              <Text style={s.stopValue}>{qty(c.adet)}</Text>
              <Text style={s.stopUnit}>{UNIT.top}</Text>
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/** İstasyon dağılımı: kuyruk çubuğu + "kuyrukta · işlemde · bugün" satırı; dış (fason) istasyon fason renginde. */
export function StationBars({ data, testID = "istasyonlar" }: { readonly data: unknown; readonly testID?: string }) {
  const s = useStyles();
  const rows = arr((data as { istasyonlar?: unknown } | null)?.istasyonlar);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => num(r.kuyruk) ?? 0));
  return (
    <View style={s.card} testID={testID}>
      {rows.map((r) => {
        const external = r.tur === "EXTERNAL";
        const today = external ? `bugün ${qty(r.bugunSevk)} sevk` : `bugün ${qty(r.bugunTamamlanan)} bitti`;
        return (
          <View key={String(r.id ?? r.ad)} style={s.station}>
            <BarRow
              label={`${str(r.ad) ?? "—"}${external ? ` · ${lookup(STATION_TYPE, "EXTERNAL")}` : ""}`}
              value={num(r.kuyruk) ?? 0}
              max={max}
              valueText={`${qty(r.kuyruk)} ${UNIT.top} kuyrukta`}
              domain={external ? "fason" : "uretim"}
              testID={`istasyon-${String(r.kod ?? r.id ?? r.ad)}`}
            />
            <Text style={s.stationFoot}>{`${qty(r.aktif)} işlemde · ${today}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  flow: { flexGrow: 1, gap: space.xs, paddingBottom: space.s, paddingRight: space.l },
  stopWrap: { flexGrow: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs },
  stop: { flexGrow: 1, minWidth: 92, backgroundColor: t.surface, borderRadius: radius.cardInner, paddingHorizontal: space.m, paddingVertical: space.s, borderTopWidth: 3, borderTopColor: t.domain.uretim.fg, ...t.cardShadow },
  stopLabel: { ...typography.caption, color: t.textSecondary },
  stopValueRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 3, marginTop: 2 },
  stopValue: { ...typography.title2, ...tabularNums, color: t.text },
  stopUnit: { ...typography.footnote, color: t.textSecondary },
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, gap: space.xl, marginBottom: space.m, ...t.cardShadow },
  station: { gap: 2 },
  // BarRow altındaki boşluğu geri al: dipnot kendi çubuğuna yapışsın, sonraki istasyonla karışmasın.
  stationFoot: { ...typography.footnote, ...tabularNums, color: t.textSecondary, marginTop: space.xs - space.m },
}));
