// İstek üzerine rapor formu: dönem (kısayol + GG.AA.YYYY) ve kesit günü; v2 raporda başka parametre sorulmaz (kıyas
// ve süzgeç varsayılanı fabrikada). Varsayılanlar son koşumun parametreleri; gövde kuralı `buildReportParams`.
import { useState } from "react";
import { Text, View } from "react-native";
import { fmtFactoryDate } from "../../../lib/factory-time";
import { REPORT_PARAM } from "../../../lib/labels/finans";
import type { FormVarsayilani } from "../../../lib/rapor-anlik";
import { buildReportParams, extraParamNames, rangeParamNames } from "../../../lib/reports";
import { Banner, Button, Field } from "../../kit";
import { SectionHeader } from "../../SectionHeader";
import { SegmentedControl } from "../../SegmentedControl";
import { makeStyles } from "../../theme-context";
import { space, typography } from "../../tokens";
import { AS_OF_CHOICES, REPORT_PERIODS, asOfDayText, asOfIso, periodText, type AsOfChoice, type ReportPeriod } from "../periods";

const AS_OF = "asOf";

export function ParamForm(p: {
  readonly parametreler: unknown;
  readonly initial: FormVarsayilani;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (params: Record<string, string>) => void;
}) {
  const s = useStyles();
  const range = rangeParamNames(p.parametreler);
  const takesAsOf = extraParamNames(p.parametreler).includes(AS_OF);
  const [from, setFrom] = useState(p.initial.from);
  const [to, setTo] = useState(p.initial.to);
  const [period, setPeriod] = useState<ReportPeriod>("ozel");
  const [asOfChoice, setAsOfChoice] = useState<AsOfChoice>(p.initial.asOf ? "ozel" : "bugun");
  const [asOfText, setAsOfText] = useState(p.initial.asOf ? fmtFactoryDate(p.initial.asOf, "") : "");
  const [error, setError] = useState<string | null>(null);
  const asOfDay = asOfDayText(asOfChoice);

  function pick(k: ReportPeriod) {
    setPeriod(k);
    const r = periodText(k);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function submit() {
    const asOf = takesAsOf ? asOfIso(asOfChoice, asOfText) : undefined;
    if (asOf === null) return setError("Tarih GG.AA.YYYY biçiminde olmalı");
    const built = buildReportParams(range ? from : "", range ? to : "", asOf ? { [AS_OF]: asOf } : {}, range ?? undefined);
    if (!built.ok) return setError(built.error);
    setError(null);
    p.onSubmit(built.params);
  }

  return (
    <View testID="rapor-form">
      {range ? (
        <>
          <SectionHeader title="Dönem" />
          <View style={{ marginBottom: space.m }}>
            <SegmentedControl items={REPORT_PERIODS} value={period} onChange={pick} testIDPrefix="donem-" accessibilityLabel="Dönem kısayolu" />
          </View>
          <Field label="Başlangıç" value={from} onChangeText={(v) => { setFrom(v); setPeriod("ozel"); }} keyboardType="numbers-and-punctuation" placeholder="GG.AA.YYYY" testID="rapor-baslangic" />
          <Field label="Bitiş" value={to} onChangeText={(v) => { setTo(v); setPeriod("ozel"); }} keyboardType="numbers-and-punctuation" placeholder="GG.AA.YYYY" hint="Boşsa raporun varsayılan dönemi." testID="rapor-bitis" />
        </>
      ) : null}
      {takesAsOf ? (
        <>
          <SectionHeader title={REPORT_PARAM[AS_OF] ?? "Kesit"} />
          <View style={{ marginBottom: space.m }}>
            <SegmentedControl items={AS_OF_CHOICES} value={asOfChoice} onChange={setAsOfChoice} testIDPrefix="kesit-" accessibilityLabel="Kesit günü" />
          </View>
          {asOfChoice === "ozel" ? (
            <Field label="Tarih" value={asOfText} onChangeText={setAsOfText} keyboardType="numbers-and-punctuation" placeholder="GG.AA.YYYY" testID="rapor-param-asOf" />
          ) : (
            <Text style={s.hint}>{asOfChoice === "bugun" ? `Şu an (${asOfDay ?? "bugün"})` : `${asOfDay ?? ""} sonu`}</Text>
          )}
        </>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Button label="Oluştur" icon="play-outline" busy={p.busy} disabled={p.disabled} onPress={submit} testID="rapor-olustur" />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  hint: { ...typography.footnote, color: t.textSecondary, marginBottom: space.m },
}));
