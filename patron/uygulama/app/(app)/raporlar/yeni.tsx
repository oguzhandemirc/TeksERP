// Rapor isteği: katalog girdisinin alanları (+ özel aralık) → BEKLIYOR; fabrika hesaplayıp sonucu yollar. Parametre
// fabrikanın şemasıdır: aralık yalnız rapor `dateFrom/dateTo` alıyorsa sorulur; gövde kuralı `buildReportParams`.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { fmtFactoryDate } from "../../../src/lib/factory-time";
import { REPORT_PARAM, reportDomain, reportTitle } from "../../../src/lib/labels/finans";
import { humanize } from "../../../src/lib/present";
import { buildReportParams, catalogEntries, extraParamNames, isPresentationKey, rangeParamNames, requestable } from "../../../src/lib/reports";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { Screen } from "../../../src/ui/Frame";
import { IconChip } from "../../../src/ui/IconChip";
import { Banner, Button, Card, Field } from "../../../src/ui/kit";
import { AS_OF_CHOICES, REPORT_PERIODS, asOfDayText, asOfIso, periodText, type AsOfChoice, type ReportPeriod } from "../../../src/ui/raporlar/periods";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { makeStyles } from "../../../src/ui/theme-context";
import { FONT_SCALE, space, typography } from "../../../src/ui/tokens";
import { useWrite } from "../../../src/ui/useWrite";

/** Kesit anı: serbest metin yerine gün seçimi (Bugün · Dün · Geçen ay sonu · Özel); değer `asOfIso`dan. */
const AS_OF = "asOf";

export default function NewReport() {
  const params = useLocalSearchParams<Record<string, string>>();
  const key = String(params.anahtar ?? "");
  const { api, permissions } = useSession();
  const router = useRouter();
  const s = useStyles();
  const catalog = useRemote("anlik:rapor-katalogu", () => api.snapshot("rapor-katalogu"));
  const all = catalogEntries(catalog.data?.veri);
  const entry = all.find((e) => e.anahtar === key);
  const prefill = Object.fromEntries(Object.entries(params).filter(([k, v]) => k !== "anahtar" && typeof v === "string")) as Record<string, string>;
  const names = [...new Set([...extraParamNames(entry?.parametreler), ...Object.keys(prefill)])];
  // Katalog girdisi yoksa (henüz gelmedi) aralık sorulur — bugünkü davranış; girdi aralık almıyorsa sorulmaz.
  const rangeNames = entry ? rangeParamNames(entry.parametreler) : (["dateFrom", "dateTo"] as const);
  const takesRange = rangeNames !== null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [period, setPeriod] = useState<ReportPeriod>("ozel");
  const [extra, setExtra] = useState<Record<string, string>>(prefill);
  const [asOfChoice, setAsOfChoice] = useState<AsOfChoice>(prefill[AS_OF] ? "ozel" : "bugun");
  // Önceden doldurulmuş an (bağlantıdan) "Özel" güne çevrilir: fabrika günü, fabrika tarih biçimiyle.
  const [asOfText, setAsOfText] = useState(prefill[AS_OF] ? fmtFactoryDate(prefill[AS_OF], "") : "");
  const takesAsOf = names.includes(AS_OF);
  const asOf = takesAsOf ? asOfIso(asOfChoice, asOfText) : undefined;
  const asOfDay = asOfDayText(asOfChoice);
  // v2 (sunumlu) raporda süzgeç/varyant/kıyas sorulmaz: "Tümü" = anahtar yok, kıyas varsayılanı fabrikada (K-KIYAS).
  const others = isPresentationKey(key) ? [] : names.filter((n) => n !== AS_OF);
  const built =
    asOf === null
      ? ({ ok: false, error: "Tarih GG.AA.YYYY biçiminde olmalı" } as const)
      : buildReportParams(takesRange ? from : "", takesRange ? to : "", { ...(isPresentationKey(key) ? {} : withoutAsOf(extra)), ...(asOf ? { [AS_OF]: asOf } : {}) }, rangeNames ?? undefined);
  const send = useCallback((id: string) => (built.ok ? api.reportCreate(id, key, built.params) : Promise.reject(new Error(built.error))), [api, built, key]);
  const w = useWrite(send);
  const allowed = requestable(key, permissions);
  const title = reportTitle(key, all);
  const dom = reportDomain(key);
  const soru = (entry as unknown as { soru?: unknown } | undefined)?.soru;

  function pick(p: ReportPeriod) {
    setPeriod(p);
    const r = periodText(p);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }

  async function submit() {
    if (!built.ok) return w.setError(built.error);
    const r = await w.run(JSON.stringify(built.params));
    if (r) router.replace({ pathname: "/raporlar/[id]", params: { id: r.id } } as never);
  }

  return (
    <Screen title="Rapor iste" module="raporlar" back>
      <Card domain={dom.domain}>
        <View style={s.head}>
          <IconChip domain={dom.domain} icon={dom.icon} size={36} />
          <Text style={s.title} maxFontSizeMultiplier={FONT_SCALE.title}>{title}</Text>
        </View>
        {typeof soru === "string" && soru !== "" ? <Text style={s.sub}>{soru}</Text> : null}
      </Card>
      {!allowed ? <Banner tone="error" icon="lock-closed-outline" text="Bu raporu isteme yetkiniz yok" /> : null}

      {takesRange ? (
        <>
          <SectionHeader title="Dönem" />
          <View style={{ marginBottom: space.m }}>
            <SegmentedControl items={REPORT_PERIODS} value={period} onChange={pick} testIDPrefix="donem-" accessibilityLabel="Dönem kısayolu" />
          </View>
          <Field
            label="Başlangıç (GG.AA.YYYY)"
            value={from}
            onChangeText={(v) => {
              setFrom(v);
              setPeriod("ozel");
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="01.09.2026"
            testID="rapor-baslangic"
          />
          <Field
            label="Bitiş (GG.AA.YYYY)"
            value={to}
            onChangeText={(v) => {
              setTo(v);
              setPeriod("ozel");
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="30.09.2026"
            hint="Boş bırakılan aralıkta raporun kendi varsayılan dönemi kullanılır."
            testID="rapor-bitis"
          />
        </>
      ) : null}
      {takesAsOf ? (
        <>
          <SectionHeader title={REPORT_PARAM[AS_OF] ?? "Kesit"} />
          <View style={{ marginBottom: space.m }}>
            <SegmentedControl items={AS_OF_CHOICES} value={asOfChoice} onChange={setAsOfChoice} testIDPrefix="kesit-" accessibilityLabel="Kesit günü" />
          </View>
          {asOfChoice === "ozel" ? (
            <Field
              label="Tarih (GG.AA.YYYY)"
              value={asOfText}
              onChangeText={setAsOfText}
              keyboardType="numbers-and-punctuation"
              placeholder="30.09.2026"
              hint="O günün sonundaki durum hesaplanır."
              testID={`rapor-param-${AS_OF}`}
            />
          ) : (
            <Text style={s.hint} testID="kesit-gunu">{asOfChoice === "bugun" ? `Şu anki durum (${asOfDay ?? "bugün"})` : `${asOfDay ?? ""} günü sonundaki durum`}</Text>
          )}
        </>
      ) : null}
      {others.length > 0 ? <SectionHeader title="Parametreler" /> : null}
      {others.map((n) => (
        <Field
          key={n}
          label={REPORT_PARAM[n] ?? humanize(n)}
          value={extra[n] ?? ""}
          onChangeText={(v) => setExtra((o) => ({ ...o, [n]: v }))}
          autoCapitalize="none"
          testID={`rapor-param-${n}`}
        />
      ))}
      {w.error ? <Banner tone="error" text={w.error} /> : null}
      <Button label="Raporu iste" icon="paper-plane-outline" busy={w.busy} disabled={w.disabled || !allowed} onPress={() => void submit()} testID="rapor-iste" />
    </Screen>
  );
}

function withoutAsOf(o: Readonly<Record<string, string>>): Record<string, string> {
  const { [AS_OF]: _drop, ...rest } = o;
  return rest;
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  title: { ...typography.title2, color: t.text, flex: 1 },
  sub: { ...typography.subhead, color: t.textSecondary, marginTop: space.s },
  hint: { ...typography.footnote, color: t.textSecondary, marginBottom: space.m },
}));
