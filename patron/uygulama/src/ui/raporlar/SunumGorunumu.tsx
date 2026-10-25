// v2 rapor sonucu (`RaporSunumu`): ana sayı + kıyas oku, ≤3 yan sayı, "Ne görüyoruz?" (ilk 3 cümle), ana grafik,
// tablo ilk satırları. HER sayı fabrikada hesaplıdır; uygulama yalnız biçimler ve ölçekler (aritmetik/kıyas YOK).
// "Ölçülemedi" sayıya çökmez: değer `null` ise metin + fabrikanın nedeni basılır, asla 0.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import {
  ANLATI_EKRAN_SAYISI,
  BIRIM_METNI,
  PARA_BIRIMLERI,
  SIDE_FIGURE_LIMIT,
  type AnaSayi,
  type AnaSayiKiyas,
  type Birim,
  type GrafikBlok,
  type RaporSunumu,
  type TabloBlok,
  type TabloHucresi,
} from "../../api/wire";
import { formatNumber } from "../../lib/format";
import { BarRow } from "../charts/BarRow";
import { Sparkline } from "../charts/Sparkline";
import type { IconName } from "../icons";
import { Banner, Card } from "../kit";
import { SectionHeader } from "../SectionHeader";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, radius, space, tabularNums, typography, type Domain, type StatusKind } from "../tokens";

/** Tabloda telefonda gösterilen satır tavanı (fazlası "N satırdan ilk M" notuyla). */
export const TABLE_ROW_LIMIT = 8;
/** Çubuk grafikte gösterilen kategori tavanı. */
export const CHART_BAR_LIMIT = 8;
export const UNMEASURED = "Ölçülemedi";

/** Sayı + birim metni: para 0 ondalık, diğerleri en çok 1; yüzde işareti öne ("%12"). `null` → "Ölçülemedi". */
export function figureText(value: number | null | undefined, unit: Birim): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNMEASURED;
  const digits = PARA_BIRIMLERI.includes(unit) ? 0 : Number.isInteger(value) ? 0 : 1;
  const n = formatNumber(value, digits);
  return unit === "yuzde" ? `%${n}` : `${n} ${BIRIM_METNI[unit] ?? ""}`.trim();
}

export interface ComparisonView {
  readonly icon: IconName;
  /** Fabrikanın renk yorumu (`durum`); nötr kıyas renksizdir. */
  readonly tone: StatusKind | null;
  readonly text: string;
}

const DIRECTION_WORD = { artti: "arttı", azaldi: "azaldı", degismedi: "değişmedi" } as const;

/** Kıyasın görünümü — yön, renk ve yüzde/fark fabrikadan AYNEN; ölçülemeyen kıyas sayı uydurmaz. */
export function comparisonView(k: AnaSayiKiyas | undefined, unit: Birim): ComparisonView | null {
  if (!k) return null;
  const tone: StatusKind | null = k.durum === "iyi" ? "iyi" : k.durum === "kotu" ? "kritik" : null;
  if (k.yon === null) return { icon: "remove-outline", tone: null, text: "Kıyas ölçülemedi" };
  const icon: IconName = k.yon === "artti" ? "arrow-up" : k.yon === "azaldi" ? "arrow-down" : "remove-outline";
  if (k.yon === "degismedi") return { icon, tone, text: "Değişmedi" };
  const amount =
    k.yuzde !== null ? `%${formatNumber(Math.abs(k.yuzde), 1)}` : k.fark !== null ? figureText(Math.abs(k.fark), unit) : null;
  return { icon, tone, text: amount ? `${amount} ${DIRECTION_WORD[k.yon]}` : DIRECTION_WORD[k.yon] };
}

function cellText(v: TabloHucresi | undefined, unit: Birim | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return unit ? figureText(v, unit) : formatNumber(v, Number.isInteger(v) ? 0 : 1);
  return v;
}

/** Ana grafiğin çizilecek serisi: soluk olmayan ilk seri (önceki dönem serisi soluk gelir). */
export function primarySeries(g: GrafikBlok | null): { name: string; values: (number | null)[]; extra: number } | null {
  if (!g || g.seriler.length === 0) return null;
  const main = g.seriler.find((x) => !x.soluk) ?? g.seriler[0]!;
  return { name: main.ad, values: main.veri, extra: g.seriler.length - 1 };
}

export function SunumGorunumu({ sunum, domain, testID = "sunum" }: { sunum: RaporSunumu; domain: Domain; testID?: string }) {
  const s = useStyles();
  const side = sunum.yanSayilar.slice(0, SIDE_FIGURE_LIMIT);
  const narrative = sunum.anlati.slice(0, ANLATI_EKRAN_SAYISI);
  return (
    <View testID={testID}>
      <MainFigureCard figure={sunum.anaSayi} period={sunum.donem.etiket} comparePeriod={sunum.kiyasDonemi?.etiket} domain={domain} />
      {side.length > 0 ? (
        <Card domain={domain} testID={`${testID}-yan`}>
          {side.map((f, i) => (
            <SideFigure key={f.olcu} figure={f} first={i === 0} />
          ))}
        </Card>
      ) : null}
      {sunum.uyarilar.map((u) => (
        <Banner key={u} tone="warn" text={u} />
      ))}
      {narrative.length > 0 ? (
        <>
          <SectionHeader title="Ne görüyoruz?" />
          <Card domain={domain} testID={`${testID}-anlati`}>
            {narrative.map((c, i) => (
              <View key={`${c.kural}-${i}`} style={[s.bulletRow, i > 0 && s.bulletGap]}>
                <View style={s.bullet} />
                <Text style={s.bulletText}>{c.metin}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <ChartCard chart={sunum.grafik} domain={domain} testID={`${testID}-grafik`} />
      <TableCard table={sunum.tablo} domain={domain} testID={`${testID}-tablo`} />
    </View>
  );
}

function MainFigureCard({ figure, period, comparePeriod, domain }: { figure: AnaSayi; period: string; comparePeriod?: string; domain: Domain }) {
  const t = useTokens();
  const s = useStyles();
  const measured = figure.deger !== null;
  const cmp = measured ? comparisonView(figure.kiyas, figure.birim) : null;
  const color = cmp?.tone ? t.status[cmp.tone] : null;
  return (
    <Card domain={domain} testID="sunum-ana-sayi">
      <Text style={s.mainLabel}>{figure.ad}</Text>
      <Text style={[s.mainValue, !measured && s.unmeasured]} maxFontSizeMultiplier={FONT_SCALE.title} adjustsFontSizeToFit numberOfLines={1} testID="sunum-ana-deger">
        {figureText(figure.deger, figure.birim)}
      </Text>
      {!measured && figure.olculemedi ? <Text style={s.reason} testID="sunum-olculemedi">{figure.olculemedi}</Text> : null}
      <Text style={s.period}>{period}</Text>
      {cmp ? (
        <View
          style={[s.cmp, { backgroundColor: color ? color.bg : t.surfaceAlt }]}
          testID="sunum-kiyas"
          accessible
          accessibilityLabel={`Kıyas: ${cmp.text}${comparePeriod ? `, ${comparePeriod}` : ""}`}
        >
          <Ionicons name={cmp.icon} size={16} color={color ? color.text : t.textSecondary} testID={`sunum-kiyas-${cmp.tone ?? "notr"}`} />
          <Text style={[s.cmpText, { color: color ? color.text : t.textSecondary }]}>{cmp.text}</Text>
          {comparePeriod ? <Text style={[s.cmpPeriod, { color: color ? color.text : t.textSecondary }]} numberOfLines={1}>{`· ${comparePeriod}`}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Yan sayı satırı (telefon dikey: etiket solda, değer sağda — uzun para tutarı kesilmez). */
function SideFigure({ figure, first }: { figure: AnaSayi; first: boolean }) {
  const s = useStyles();
  const text = figureText(figure.deger, figure.birim);
  return (
    <View style={[s.side, !first && s.tSep]} accessible accessibilityLabel={`${figure.ad}: ${text}`} testID={`sunum-yan-${figure.olcu}`}>
      <View style={s.sideText}>
        <Text style={s.sideLabel}>{figure.ad}</Text>
        {figure.deger === null && figure.olculemedi ? <Text style={s.sideReason}>{figure.olculemedi}</Text> : null}
      </View>
      <Text style={[s.sideValue, figure.deger === null && s.unmeasuredSmall]}>{text}</Text>
    </View>
  );
}

function ChartCard({ chart, domain, testID }: { chart: GrafikBlok | null; domain: Domain; testID: string }) {
  const s = useStyles();
  const series = primarySeries(chart);
  if (!chart || !series) return null;
  const unit = chart.eksen.y.birim;
  const finite = series.values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return null;
  const line = chart.tur === "cizgi" || chart.eksen.x.tur === "zaman";
  const bars = chart.kategoriler.slice(0, CHART_BAR_LIMIT).map((k, i) => ({ label: k, value: series.values[i] ?? null }));
  const max = Math.max(...finite);
  return (
    <>
      <SectionHeader title={chart.eksen.y.ad || series.name} />
      <Card domain={domain} testID={testID}>
        {line ? (
          <View style={s.lineWrap}>
            <Sparkline data={finite} width={300} height={96} domain={domain} accessibilityLabel={`${series.name} eğilimi`} />
            <View style={s.axisRow}>
              <Text style={s.axis}>{chart.kategoriler[0] ?? ""}</Text>
              <Text style={s.axis}>{chart.kategoriler[chart.kategoriler.length - 1] ?? ""}</Text>
            </View>
          </View>
        ) : (
          bars.map((b) => (
            <BarRow key={b.label} label={b.label} value={b.value ?? 0} max={max} valueText={figureText(b.value, unit)} domain={domain} />
          ))
        )}
        {series.extra > 0 || chart.kategoriler.length > CHART_BAR_LIMIT ? (
          <Text style={s.note}>{line ? `${series.name}` : `${series.name} · ilk ${Math.min(CHART_BAR_LIMIT, chart.kategoriler.length)} kalem`}</Text>
        ) : null}
      </Card>
    </>
  );
}

function TableCard({ table, domain, testID }: { table: TabloBlok | null; domain: Domain; testID: string }) {
  const s = useStyles();
  if (!table || table.kolonlar.length === 0) return null;
  const [head, ...rest] = table.kolonlar;
  const rows = table.satirlar.slice(0, TABLE_ROW_LIMIT);
  const total = table.kesildi?.toplam ?? table.satirlar.length;
  return (
    <>
      <SectionHeader title="Ayrıntı" />
      <Card domain={domain} testID={testID}>
        {rows.length === 0 ? <Text style={s.empty} testID={`${testID}-bos`}>Bu dönemde kayıt yok</Text> : null}
        {rows.map((r, i) => (
          <View key={i} style={[s.tRow, i > 0 && s.tSep]}>
            <Text style={s.tHead} numberOfLines={2}>{cellText(r[head!.anahtar], head!.birim)}</Text>
            {rest.slice(0, 3).map((c) => (
              <View key={c.anahtar} style={s.tCell}>
                <Text style={s.tLabel} numberOfLines={1}>{c.baslik}</Text>
                <Text style={s.tValue} numberOfLines={1}>{cellText(r[c.anahtar], c.birim)}</Text>
              </View>
            ))}
          </View>
        ))}
        {total > rows.length ? <Text style={s.note}>{`${formatNumber(total, 0)} satırdan ilk ${rows.length}; tamamı panelde.`}</Text> : null}
      </Card>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  mainLabel: { ...typography.subhead, color: t.textSecondary },
  mainValue: { ...typography.display, color: t.text, marginTop: space.xs },
  unmeasured: { ...typography.title2, color: t.textSecondary },
  unmeasuredSmall: { color: t.textSecondary },
  reason: { ...typography.footnote, color: t.textSecondary, marginTop: space.xs },
  period: { ...typography.footnote, color: t.textSecondary, marginTop: space.s },
  cmp: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, alignSelf: "flex-start" as const, borderRadius: radius.cardInner, paddingHorizontal: space.s, paddingVertical: space.xs, marginTop: space.s, maxWidth: "100%" as const },
  cmpText: { ...typography.subhead, ...tabularNums, fontWeight: "600" as const },
  cmpPeriod: { ...typography.footnote, flexShrink: 1 },
  side: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, gap: space.m, paddingVertical: space.s + 2 },
  sideText: { flexShrink: 1 },
  sideLabel: { ...typography.subhead, color: t.textSecondary },
  sideReason: { ...typography.caption, color: t.textSecondary, marginTop: 2 },
  sideValue: { ...typography.headline, ...tabularNums, color: t.text, textAlign: "right" as const },
  bulletRow: { flexDirection: "row" as const, gap: space.s, alignItems: "flex-start" as const },
  bulletGap: { marginTop: space.s },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.tint, marginTop: 8 },
  bulletText: { ...typography.callout, color: t.text, flex: 1 },
  lineWrap: { alignItems: "center" as const },
  axisRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignSelf: "stretch" as const, marginTop: space.xs },
  axis: { ...typography.caption, color: t.textSecondary },
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.s },
  empty: { ...typography.subhead, color: t.textSecondary },
  tRow: { paddingVertical: space.s },
  tSep: { borderTopWidth: 1, borderTopColor: t.separator },
  tHead: { ...typography.headline, color: t.text, marginBottom: 2 },
  tCell: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: space.m },
  tLabel: { ...typography.footnote, color: t.textSecondary, flexShrink: 1 },
  tValue: { ...typography.footnote, ...tabularNums, color: t.text },
}));
