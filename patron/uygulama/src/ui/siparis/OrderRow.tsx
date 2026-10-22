// Sipariş satırı: müşteri adı (yoksa "—") + sipariş no · durum / termin · tutar; sağda açık miktar + termin rozeti.
// Her değer fabrikadan (açık miktar, gecikmiş); uygulama hesap ve tarih karşılaştırması yapmaz.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import type { ProjectionRecord } from "../../api/wire";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";
import { deadlineBadge, isOpenOrder, orderStatus } from "../../lib/labels/siparis";
import { IconChip } from "../IconChip";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, space, tabularNums, typography } from "../tokens";

export type Obj = Readonly<Record<string, unknown>>;

export const asObj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const present = (v: unknown): boolean => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "");

/** Satır metinleri (test ve erişilebilirlik aynı kaynaktan). */
export function orderRowText(r: ProjectionRecord, showCustomer = true) {
  const k = asObj(r.kayit);
  const f = asObj(r.finans);
  const no = str(k.siparisNo) ?? "—";
  const title = showCustomer ? (str(k.musteriAdi) ?? "—") : no;
  const line1 = [showCustomer ? no : null, orderStatus(k.durum).label].filter(Boolean).join(" · ");
  const line2 = [str(k.termin) ? `Termin ${formatDate(k.termin)}` : null, present(f.tutar) ? formatMoney(f.tutar, str(k.doviz) ?? "TRY") : null].filter(Boolean).join(" · ");
  // Açık miktar ölçülen (metre) kalemlerin toplamıdır (fabrika `acikMiktar`); kapanmış siparişte gösterilmez.
  const open = isOpenOrder(k.durum) && present(k.acikMiktar) ? `${formatNumber(k.acikMiktar)} m` : null;
  return { title, line1, line2, subtitle: line2 ? `${line1}\n${line2}` : line1, open, badge: deadlineBadge(k) };
}

/** Üç katlı satır: ad + açık metre · no + durum · termin tarihi + tutar + termin rozeti (metin tam genişlik kullanır). */
export function OrderRow({ r, onPress, showCustomer = true }: { r: ProjectionRecord; onPress?: () => void; showCustomer?: boolean }) {
  const t = useTokens();
  const s = useStyles();
  const x = orderRowText(r, showCustomer);
  const late = x.badge?.tone === "kritik";
  const label = [x.title, x.line1, x.line2, x.open ? `açık ${x.open}` : null, x.badge?.label].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={`siparis-${r.id}`}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}
    >
      <IconChip domain="siparisler" icon={late ? "alert-circle-outline" : undefined} size={36} />
      <View style={s.text}>
        <View style={s.line}>
          <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.body}>{x.title}</Text>
          {x.open ? <Text style={[s.value, late ? { color: t.status.kritik.fill } : null]} numberOfLines={1}>{x.open}</Text> : null}
        </View>
        <Text style={s.subtitle} numberOfLines={1}>{x.line1}</Text>
        {x.line2 || x.badge ? (
          <View style={s.line}>
            <Text style={s.meta} numberOfLines={1}>{x.line2}</Text>
            {x.badge ? <StatusBadge kind={x.badge.tone} label={x.badge.label} size="sm" testID={`termin-${r.id}`} /> : null}
          </View>
        ) : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  title: { ...typography.headline, color: t.text, flex: 1 },
  subtitle: { ...typography.subhead, color: t.textSecondary, flex: 1 },
  meta: { ...typography.footnote, ...tabularNums, color: t.textMuted, flex: 1 },
  value: { ...typography.headline, ...tabularNums, color: t.text },
}));
