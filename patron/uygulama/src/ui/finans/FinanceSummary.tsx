// Finans özeti (`ozet-finans` anlığı): açık alacak kahramanı + yaşlandırma çubuğu (döviz başına ayrı blok) ve çek/senet
// vade kovaları. Toplam, gecikmiş, avans ve kova tutarları FABRİKANIN hesabıdır; uygulama toplamaz, çıkarmaz, yalnız
// para birimiyle basar. Net/borç anlıkta yok → gösterilmez (uydurulmaz).
import { Text, View } from "react-native";
import { formatMoney } from "../../lib/format";
import { AGING_BUCKET, AGING_BUCKETS, CHEQUE_DUE_BUCKET, CHEQUE_DUE_BUCKETS, CHEQUE_KIND } from "../../lib/labels/finans";
import { AgingBar, type AgingSegment } from "../charts/AgingBar";
import { IconChip } from "../IconChip";
import { Card } from "../kit";
import { SectionHeader } from "../SectionHeader";
import { Empty } from "../StateViews";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, radius, space, tabularNums, typography, type StatusKind } from "../tokens";
import { EMPTY_ICON } from "../icons";

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface AgingBlock {
  readonly doviz: string;
  readonly acikToplam: unknown;
  readonly gecikmis: unknown;
  readonly avans: unknown;
  readonly kovalar: Obj;
}

export interface ChequeGroup {
  readonly tur: string;
  readonly doviz: string;
  readonly rows: readonly Obj[];
}

/** Telden okunan bloklar; şekil fabrikada tanımlı, burada yalnız savunmacı okuma. */
export function agingBlocks(veri: unknown): AgingBlock[] {
  return arr(obj(veri).yaslandirma).map((b) => ({ doviz: str(b.doviz), acikToplam: b.acikToplam, gecikmis: b.gecikmis, avans: b.avans, kovalar: obj(b.kovalar) }));
}

/** Çek vade satırları (tür, döviz) grubuna ayrılır — gruplama yalnız düzen, tutar toplanmaz. */
export function chequeGroups(veri: unknown): ChequeGroup[] {
  const out: ChequeGroup[] = [];
  for (const row of arr(obj(veri).cekVade)) {
    const tur = str(row.tur);
    const doviz = str(row.doviz);
    const g = out.find((x) => x.tur === tur && x.doviz === doviz);
    if (g) (g.rows as Obj[]).push(row);
    else out.push({ tur, doviz, rows: [row] });
  }
  return out;
}

/** Çubuk genişliği için sayı (yalnız GÖRSEL oran; metin fabrikanın dizisinden basılır). */
const width = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0);

export function agingSegments(b: AgingBlock): AgingSegment[] {
  return AGING_BUCKETS.filter((k) => b.kovalar[k] !== undefined).map((k) => ({
    label: AGING_BUCKET[k].label,
    tone: AGING_BUCKET[k].tone,
    shade: AGING_BUCKET[k].shade,
    value: width(b.kovalar[k]),
    valueText: formatMoney(b.kovalar[k], b.doviz),
  }));
}

export function chequeSegments(g: ChequeGroup): AgingSegment[] {
  return CHEQUE_DUE_BUCKETS.flatMap((k) => {
    const row = g.rows.find((r) => r.kova === k);
    if (!row) return [];
    const adet = typeof row.adet === "number" ? ` (${row.adet})` : "";
    return [{ label: `${CHEQUE_DUE_BUCKET[k].label}${adet}`, tone: CHEQUE_DUE_BUCKET[k].tone, value: width(row.tutar), valueText: formatMoney(row.tutar, g.doviz) }];
  });
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: StatusKind }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <View style={[s.mini, tone ? { backgroundColor: t.status[tone].bg } : null]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.miniLabel, tone ? { color: t.status[tone].text } : null]} numberOfLines={1}>{label}</Text>
      <Text style={[s.miniValue, tone ? { color: t.status[tone].text } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

/** Açık alacak kahramanı: döviz başına büyük tutar + gecikmiş/avans + yaşlandırma çubuğu (döviz ayrı satır). */
export function ReceivableHero({ veri, caption }: { veri: unknown; caption?: string }) {
  const s = useStyles();
  const blocks = agingBlocks(veri);
  return (
    <Card domain="finans" testID="finans-alacak">
      <View style={s.head}>
        <IconChip domain="finans" icon="trending-up-outline" />
        <Text style={s.headTitle} maxFontSizeMultiplier={FONT_SCALE.title}>Açık alacak</Text>
      </View>
      {caption ? <Text style={s.caption}>{caption}</Text> : null}
      {blocks.length === 0 ? <Text style={s.none}>Açık alacak yok</Text> : null}
      {blocks.map((b, i) => (
        <View key={b.doviz || i} style={[s.block, i > 0 && s.blockSep]} testID={`alacak-${b.doviz}`}>
          {blocks.length > 1 ? <Text style={s.currency}>{b.doviz}</Text> : null}
          <Text style={s.big} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE.title} accessibilityLabel={`Açık alacak: ${formatMoney(b.acikToplam, b.doviz)}`}>
            {formatMoney(b.acikToplam, b.doviz)}
          </Text>
          <View style={s.minis}>
            <Mini label="Vadesi geçmiş" value={formatMoney(b.gecikmis, b.doviz)} tone={width(b.gecikmis) > 0 ? "kritik" : undefined} />
            <Mini label="Avans (eşleşmemiş)" value={formatMoney(b.avans, b.doviz)} />
          </View>
          <Text style={s.barTitle}>Yaşlandırma</Text>
          <AgingBar segments={agingSegments(b)} testID={`yaslandirma-${b.doviz}`} />
        </View>
      ))}
    </Card>
  );
}

/** Çek/senet vade kovaları: (alınan/verilen, döviz) başına bir çubuk; kovanın adedi etikette. */
export function ChequeDue({ veri }: { veri: unknown }) {
  const s = useStyles();
  const groups = chequeGroups(veri);
  return (
    <View>
      <SectionHeader title="Çek ve senet vadeleri" domain="finans" />
      {groups.length === 0 ? (
        <Empty text="Vadesi beklenen çek/senet yok" domain="finans" icon={EMPTY_ICON.vade} />
      ) : (
        <Card domain="finans" testID="finans-cek-vade">
          {groups.map((g, i) => (
            <View key={`${g.tur}-${g.doviz}`} style={[s.block, i > 0 && s.blockSep]}>
              <View style={s.groupHead}>
                <IconChip domain="finans" icon={g.tur === "ISSUED" ? "arrow-up-circle-outline" : "arrow-down-circle-outline"} size={28} />
                <Text style={s.groupTitle}>{`${CHEQUE_KIND[g.tur] ?? g.tur} çek/senet`}</Text>
                <Text style={s.currency}>{g.doviz}</Text>
              </View>
              <AgingBar segments={chequeSegments(g)} testID={`cek-vade-${g.tur}-${g.doviz}`} />
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  headTitle: { ...typography.headline, color: t.text },
  caption: { ...typography.footnote, color: t.textMuted, marginTop: space.xs },
  none: { ...typography.callout, color: t.textSecondary, marginTop: space.m },
  block: { marginTop: space.m },
  blockSep: { borderTopWidth: 1, borderTopColor: t.separator, paddingTop: space.m },
  currency: { ...typography.caption, color: t.textSecondary, backgroundColor: t.surfaceAlt, borderRadius: radius.chip, paddingHorizontal: space.s, paddingVertical: 2, alignSelf: "flex-start" as const, overflow: "hidden" as const },
  big: { ...typography.display, color: t.text, marginTop: space.xs },
  minis: { flexDirection: "row" as const, gap: space.s, marginTop: space.m },
  mini: { flex: 1, backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, padding: space.s + 2 },
  miniLabel: { ...typography.caption, color: t.textSecondary },
  miniValue: { ...typography.headline, ...tabularNums, color: t.text, marginTop: 2 },
  barTitle: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginTop: space.l, marginBottom: space.s },
  groupHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginBottom: space.s },
  groupTitle: { ...typography.headline, color: t.text, flex: 1 },
}));
