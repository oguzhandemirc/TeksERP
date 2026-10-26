// Jenerik kayıt ayrıntısı: kök alanlar + izinliyse finans/kişisel alt satırı (sunucu süzer). Finans alt satırı taşıyan
// projeksiyonda alt satır yoksa tutarlar HİÇ basılmaz, kilit gösterilir. Tutar kaydın dövizi ile; tarih fabrika diliminden.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { FINANCE_LOCKED_TEXT, FINANCE_SUBROW_PROJECTIONS, RECORD_ENUMS } from "../../../../src/lib/labels/finans";
import { humanize, recordTitle } from "../../../../src/lib/present";
import { TERIM } from "../../../../src/lib/terim";
import { useSession } from "../../../../src/state/session";
import { useRemote } from "../../../../src/state/useRemote";
import { ErrorBox, Fields } from "../../../../src/ui/data";
import { recordCurrency } from "../../../../src/ui/finans/rows";
import { Screen } from "../../../../src/ui/Frame";
import { IconChip } from "../../../../src/ui/IconChip";
import type { IconName } from "../../../../src/ui/icons";
import { Card } from "../../../../src/ui/kit";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { LoadingSkeleton } from "../../../../src/ui/StateViews";
import { makeStyles, useTokens } from "../../../../src/ui/theme-context";
import { FONT_SCALE, space, typography, type Domain } from "../../../../src/ui/tokens";
import { QuoteLines } from "../../../../src/ui/teklif/QuoteLines";

/** Projeksiyon → okunur tür adı + alan rengi/ikon (başlık çipi). Bilinmeyen ad okunur hâle getirilir. */
const KIND: Readonly<Record<string, { readonly label: string; readonly domain: Domain; readonly icon: IconName }>> = {
  kasa: { label: "Kasa", domain: "finans", icon: "cash-outline" },
  banka: { label: "Banka hesabı", domain: "finans", icon: "business-outline" },
  "kasa-hareketi": { label: "Kasa hareketi", domain: "finans", icon: "swap-vertical-outline" },
  "cek-senet": { label: "Çek/senet", domain: "finans", icon: "card-outline" },
  fatura: { label: "Fatura", domain: "finans", icon: "document-text-outline" },
  "fatura-kalemi": { label: "Fatura kalemi", domain: "finans", icon: "list-outline" },
  "tahsilat-odeme": { label: "Tahsilat/ödeme", domain: "finans", icon: "swap-horizontal-outline" },
  "cari-hesap": { label: "Cari hesap", domain: "cariler", icon: "people-outline" },
  "cari-hareket": { label: "Cari hareket", domain: "cariler", icon: "swap-vertical-outline" },
  siparis: { label: "Sipariş", domain: "siparisler", icon: "receipt-outline" },
  "siparis-kalemi": { label: "Sipariş kalemi", domain: "siparisler", icon: "list-outline" },
  sevkiyat: { label: "Sevkiyat", domain: "sevkiyat", icon: "car-outline" },
  "is-emri": { label: TERIM.terbiyeIsEmri.tekil, domain: "uretim", icon: "construct-outline" },
  fiyat: { label: "Fiyat", domain: "finans", icon: "pricetag-outline" },
  teklif: { label: "Teklif", domain: "siparisler", icon: "document-text-outline" },
  "teklif-kalemi": { label: "Teklif kalemi", domain: "siparisler", icon: "list-outline" },
  "standart-maliyet": { label: "Standart maliyet", domain: "finans", icon: "calculator-outline" },
};

export default function RecordDetail() {
  const { projeksiyon, id } = useLocalSearchParams<{ projeksiyon: string; id: string }>();
  const { api } = useSession();
  const t = useTokens();
  const s = useStyles();
  const p = String(projeksiyon ?? "");
  const r = useRemote(projeksiyon && id ? `kayit:${projeksiyon}:${id}` : null, () => api.record(p, String(id)));
  const kind = KIND[p] ?? { label: humanize(p), domain: "genel" as Domain, icon: "document-outline" as IconName };
  const d = r.data;
  const financeLocked = d !== null && d.finans === undefined && FINANCE_SUBROW_PROJECTIONS.includes(p);
  const title = d ? recordTitle(d.kayit) : "Kayıt";
  return (
    <Screen title={title === "Kayıt" ? kind.label : title} back onRefresh={r.reload} refreshing={r.refreshing}>
      {r.loading && !d ? <LoadingSkeleton rows={5} /> : null}
      {r.error && !d ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {d ? (
        <>
          <Card domain={kind.domain} testID="kayit-ozet">
            <View style={s.head}>
              <IconChip domain={kind.domain} icon={kind.icon} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.kind}>{kind.label}</Text>
                <Text style={s.title} maxFontSizeMultiplier={FONT_SCALE.title} numberOfLines={2}>{title}</Text>
              </View>
            </View>
            <View style={s.fields}>
              <Fields value={d.kayit} enums={RECORD_ENUMS[p]} />
            </View>
          </Card>
          {d.finans !== undefined ? (
            <>
              <SectionHeader title="Tutarlar" domain="finans" />
              <Card domain="finans" testID="kayit-tutarlar">
                {d.finans === null ? <Text style={s.kind}>Tutar bilgisi yok</Text> : <Fields value={d.finans} currency={recordCurrency(d.kayit)} />}
              </Card>
            </>
          ) : null}
          {financeLocked ? (
            <>
              <SectionHeader title="Tutarlar" />
              <Card testID="kayit-tutarlar-kilitli">
                <View style={s.locked} accessible accessibilityLabel={FINANCE_LOCKED_TEXT}>
                  <Ionicons name="lock-closed" size={20} color={t.textMuted} />
                  <Text style={s.lockedText}>{FINANCE_LOCKED_TEXT}</Text>
                </View>
              </Card>
            </>
          ) : null}
          {p === "teklif" ? <QuoteLines teklifId={String(id)} currency={recordCurrency(d.kayit)} /> : null}
          {d.kisisel !== undefined && d.kisisel !== null ? (
            <>
              <SectionHeader title="İletişim" />
              <Card domain={kind.domain}>
                <Fields value={d.kisisel} />
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  kind: { ...typography.footnote, color: t.textSecondary },
  title: { ...typography.title2, color: t.text },
  fields: { marginTop: space.m },
  locked: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  lockedText: { ...typography.callout, color: t.textSecondary, flex: 1 },
}));
