// İstek ayrıntısı: başlık sözlükten, durum rozeti, parametreler, (HAZIR ise) fabrikanın sonucu; BEKLIYOR'da iptal
// (iki adımlı onay). `rapor` etiketiyle ve bekleyen istekte kısa yoklamayla kendiliğinden tazelenir; elle: aşağı çek.
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import { formatDateTime } from "../../../src/lib/format";
import { REPORT_ERROR, reportDomain, reportPending, reportTitle } from "../../../src/lib/labels/finans";
import { catalogEntries, isPresentation, isPresentationKey } from "../../../src/lib/reports";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox, SnapshotView } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { IconChip } from "../../../src/ui/IconChip";
import { Banner, Card, ConfirmButton } from "../../../src/ui/kit";
import { ParamRows, ReportStatusBadge } from "../../../src/ui/raporlar/parts";
import { SunumGorunumu } from "../../../src/ui/raporlar/SunumGorunumu";
import { usePendingPoll } from "../../../src/ui/raporlar/usePendingPoll";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { FONT_SCALE, radius, space, typography } from "../../../src/ui/tokens";

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, offline } = useSession();
  const t = useTokens();
  const s = useStyles();
  const r = useRemote(id ? `rapor:${id}` : null, () => api.reportGet(String(id)), { tags: ["rapor"] });
  const catalog = useRemote("anlik:rapor-katalogu", () => api.snapshot("rapor-katalogu"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = r.data;
  usePendingPoll(reportPending(d?.durum), r.reload);
  const title = d ? reportTitle(d.raporAnahtari, catalogEntries(catalog.data?.veri)) : "Rapor";
  const dom = d ? reportDomain(d.raporAnahtari) : null;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.reportCancel(String(id));
      invalidate(["rapor"]);
    } catch (err) {
      setError(errorMessage(err));
      r.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={title} module="raporlar" back onRefresh={r.reload} refreshing={r.refreshing}>
      {r.loading && !d ? <LoadingSkeleton rows={4} /> : null}
      {r.error && !d ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {d && dom ? (
        <>
          <Card domain={dom.domain} testID="rapor-ozet">
            <View style={s.head}>
              <IconChip domain={dom.domain} icon={dom.icon} size={36} />
              <Text style={s.title} maxFontSizeMultiplier={FONT_SCALE.title}>{title}</Text>
            </View>
            <View style={s.badgeRow}>
              <ReportStatusBadge status={d.durum} testID="rapor-durum" />
            </View>
            <View style={s.meta}>
              <Text style={s.metaText}>{`İstendi: ${formatDateTime(d.olusturulma)}`}</Text>
              {d.tamamlanma ? <Text style={s.metaText}>{`Tamamlandı: ${formatDateTime(d.tamamlanma)}`}</Text> : null}
            </View>
            <View style={s.params}>
              <ParamRows params={d.parametreler} />
            </View>
          </Card>

          {reportPending(d.durum) ? (
            <View style={[s.pending, { backgroundColor: t.status.bilgi.bg }]} testID="rapor-bekliyor" accessibilityRole="progressbar">
              <ActivityIndicator color={t.status.bilgi.fill} />
              <Text style={[s.pendingText, { color: t.status.bilgi.text }]}>
                {d.durum === "BEKLIYOR" ? "İstek fabrikaya iletildi; sıra gelince hesaplanacak. Bu ekran kendiliğinden güncellenir." : "Fabrika raporu hesaplıyor; hazır olunca sonuç burada görünür."}
              </Text>
            </View>
          ) : null}
          {d.durum === "HATA" ? <Banner tone="error" text={`Rapor hesaplanamadı. ${(d.hataKodu ? REPORT_ERROR[d.hataKodu] : undefined) ?? "Yeniden isteyebilirsiniz."}`} testID="rapor-hata" /> : null}

          {d.sonuc && isPresentationKey(d.raporAnahtari) && isPresentation(d.sonuc.veri) ? (
            <>
              <SectionHeader title="Sonuç" />
              <Text style={[s.metaText, s.computed]}>{`Fabrikada hesaplandı: ${formatDateTime(d.sonuc.hesaplandi)}`}</Text>
              <SunumGorunumu sunum={d.sonuc.veri} domain={dom.domain} />
            </>
          ) : d.sonuc ? (
            <>
              <SectionHeader title="Sonuç" />
              <Card domain={dom.domain} testID="rapor-sonuc">
                <Text style={s.metaText}>{`Hesaplandı: ${formatDateTime(d.sonuc.hesaplandi)}`}</Text>
                <View style={{ marginTop: space.m }}>
                  <SnapshotView value={d.sonuc.veri} />
                </View>
              </Card>
            </>
          ) : null}
          {error ? <Banner tone="error" text={error} /> : null}
          {d.durum === "BEKLIYOR" ? (
            <ConfirmButton label="İsteği iptal et" question="Rapor isteği iptal edilsin mi?" busy={busy} disabled={offline} onConfirm={() => void cancel()} testID="rapor-iptal" />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  title: { ...typography.title2, color: t.text, flex: 1 },
  badgeRow: { flexDirection: "row" as const, marginTop: space.m },
  meta: { marginTop: space.s, gap: 2 },
  metaText: { ...typography.footnote, color: t.textSecondary },
  computed: { marginBottom: space.s },
  params: { marginTop: space.m, backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, paddingHorizontal: space.m, paddingVertical: space.xs },
  pending: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, padding: space.m, borderRadius: radius.cardInner, marginBottom: space.m },
  pendingText: { ...typography.subhead, flex: 1 },
}));
