// Sipariş ayrıntısı: başlık kartı (müşteri, no, durum + termin rozeti, açık metre, tutar) + teslim ve kalem özeti.
// Her değer fabrikadan; durum/yön sözlükten. Kalem satırları: bulut `siparis-kalemi` listesinde sipariş süzgeci yok
// (yalnız `durum`/`cariKartId`) — istemci süzmez, bu yüzden burada fabrikanın kalem özeti gösterilir.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { moduleVisible } from "../../../../src/lib/access";
import { fmtFactoryDateTime } from "../../../../src/lib/factory-time";
import { formatDate, formatMoney, formatNumber } from "../../../../src/lib/format";
import { deadlineBadge, destinationLabel, isOpenOrder, orderStatus } from "../../../../src/lib/labels/siparis";
import { useSession } from "../../../../src/state/session";
import { useRemote } from "../../../../src/state/useRemote";
import { Screen } from "../../../../src/ui/Frame";
import { IconChip } from "../../../../src/ui/IconChip";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { ErrorState, LoadingSkeleton } from "../../../../src/ui/StateViews";
import { StatusBadge } from "../../../../src/ui/StatusBadge";
import { asObj, str } from "../../../../src/ui/siparis/OrderRow";
import { FactGroup, FactRow, StaleNote } from "../../../../src/ui/siparis/parts";
import { makeStyles, useTokens } from "../../../../src/ui/theme-context";
import { FONT_SCALE, STRIPE, TOUCH, radius, space, tabularNums, typography } from "../../../../src/ui/tokens";

const has = (v: unknown): boolean => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "");

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, permissions } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const r = useRemote(id ? `kayit:siparis:${id}` : null, () => api.record("siparis", String(id)));
  const k = asObj(r.data?.kayit);
  const f = asObj(r.data?.finans);
  const no = str(k.siparisNo);
  const status = orderStatus(k.durum);
  const badge = deadlineBadge(k);
  const doviz = str(k.doviz) ?? "TRY";
  const cariId = str(k.cariKartId);
  const showOpen = isOpenOrder(k.durum) && has(k.acikMiktar);
  return (
    <Screen title={no ?? "Sipariş"} module="siparisler" back onRefresh={r.reload} refreshing={r.refreshing} subtitle={<StaleNote stale={r.stale} savedAt={r.savedAt} />}>
      {r.loading && !r.data ? <LoadingSkeleton rows={3} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <>
          <View style={s.hero} testID="siparis-baslik">
            <View style={[s.stripe, { backgroundColor: t.domain.siparisler.fg }]} />
            <View style={s.heroHead}>
              <IconChip domain="siparisler" size={44} />
              <View style={s.flex}>
                <Text style={s.caption}>Müşteri</Text>
                <Text style={s.customer} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.title} testID="siparis-musteri">{str(k.musteriAdi) ?? "—"}</Text>
              </View>
            </View>
            <View style={s.badges}>
              <StatusBadge kind={status.tone} label={status.label} testID="siparis-durum" />
              {badge ? <StatusBadge kind={badge.tone} label={badge.label} testID="siparis-termin" /> : null}
            </View>
            <View style={s.figures}>
              {showOpen ? (
                <View style={s.figure}>
                  <Text style={s.figLabel}>Açık miktar</Text>
                  <View style={s.figRow}>
                    <Text style={[s.figValue, badge?.tone === "kritik" ? { color: t.status.kritik.fill } : null]} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(k.acikMiktar)}</Text>
                    <Text style={s.figUnit}>m</Text>
                  </View>
                </View>
              ) : null}
              {has(f.tutar) ? (
                <View style={s.figure}>
                  <Text style={s.figLabel}>Sipariş tutarı</Text>
                  <Text style={s.figValue} numberOfLines={1} adjustsFontSizeToFit testID="siparis-tutar">{formatMoney(f.tutar, doviz)}</Text>
                </View>
              ) : null}
            </View>
            {cariId && moduleVisible(permissions, "cariler") ? (
              <Pressable
                style={({ pressed }) => [s.link, pressed && { opacity: 0.7 }]} accessibilityRole="link" testID="siparis-cari"
                onPress={() => router.push({ pathname: "/cariler/[id]", params: { id: cariId } } as never)}
              >
                <Text style={s.linkText}>Cari kartını aç</Text>
                <Ionicons name="chevron-forward" size={16} color={t.tint} />
              </Pressable>
            ) : null}
          </View>

          <SectionHeader title="Teslim" />
          <FactGroup>
            <FactRow label="Termin" value={formatDate(k.termin)} tone={badge?.tone === "kritik" ? "kritik" : undefined} />
            <FactRow label="Sipariş tarihi" value={formatDate(k.siparisTarihi)} />
            <FactRow label="Sevk yönü" value={destinationLabel(k.yon)} />
            <FactRow label="Para birimi" value={doviz} />
            {str(k.tamamlanma) ? <FactRow label="Tamamlanma" value={formatDate(k.tamamlanma)} tone="iyi" /> : null}
            {str(k.iptalTarihi) ? <FactRow label="İptal tarihi" value={formatDate(k.iptalTarihi)} /> : null}
          </FactGroup>

          <SectionHeader title="Kalemler" count={typeof k.kalemSayisi === "number" ? k.kalemSayisi : undefined} />
          <FactGroup testID="siparis-kalem-ozeti">
            <FactRow label="Etkin kalem" value={has(k.kalemSayisi) ? `${formatNumber(k.kalemSayisi, 0)} kalem` : "—"} />
          </FactGroup>

          <Text style={s.foot} testID="fabrika-veri-ani">{`Fabrika verisi ${fmtFactoryDateTime(r.data.surum)}`}</Text>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hero: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, overflow: "hidden" as const, marginBottom: space.s, gap: space.m, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  heroHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  flex: { flex: 1 },
  customer: { ...typography.title2, color: t.text },
  caption: { ...typography.caption, color: t.textSecondary, marginBottom: 2 },
  badges: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.s },
  figures: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.l },
  figure: { flexGrow: 1, flexBasis: 140 },
  figLabel: { ...typography.caption, color: t.textSecondary },
  figRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: space.xs },
  figValue: { ...typography.kpi, color: t.text, flexShrink: 1 },
  figUnit: { ...typography.subhead, color: t.textSecondary },
  link: { minHeight: TOUCH - 8, flexDirection: "row" as const, alignItems: "center" as const, alignSelf: "flex-start" as const, gap: 2 },
  linkText: { ...typography.subhead, fontWeight: "600" as const, color: t.tint },
  foot: { ...typography.footnote, color: t.textMuted, textAlign: "center" as const, marginTop: space.m },
}));
