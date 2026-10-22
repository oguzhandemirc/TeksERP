// Yeni sipariş fabrikaya GELEN KUTUSU üzerinden gider: sipariş no, yön, durum fabrikada doğar.
// Gövde `buildOrder` (forms.ts), gönderim `useWrite` (işlem kimliği kuralı) — yalnız görünüm yenilendi.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { addDaysToKey, factoryDayKey, fmtDayKey } from "../../../../src/lib/factory-time";
import { buildOrder, type OrderLineInput } from "../../../../src/lib/forms";
import { useSession } from "../../../../src/state/session";
import { Screen } from "../../../../src/ui/Frame";
import { IconChip } from "../../../../src/ui/IconChip";
import { Banner, Button, Field } from "../../../../src/ui/kit";
import { Picker, type Picked } from "../../../../src/ui/Picker";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../../src/ui/SegmentedControl";
import { makeStyles, useTokens } from "../../../../src/ui/theme-context";
import { STRIPE, TOUCH, radius, space, typography } from "../../../../src/ui/tokens";
import { useWrite } from "../../../../src/ui/useWrite";

interface Line { urun: Picked | null; renk: Picked | null; miktar: string; birimFiyat: string }
const EMPTY: Line = { urun: null, renk: null, miktar: "", birimFiyat: "" };
type Currency = "TRY" | "USD" | "EUR";
const CURRENCIES = [{ key: "TRY" as const, label: "TL ₺" }, { key: "USD" as const, label: "USD $" }, { key: "EUR" as const, label: "EUR €" }];
/** Hızlı termin: fabrika gününden ileri sayılan takvim günü (metin alanını doldurur; elle de yazılır). */
const QUICK = [{ key: "0", label: "Bugün", days: 0 }, { key: "7", label: "+7 gün", days: 7 }, { key: "30", label: "+30 gün", days: 30 }] as const;
type QuickKey = (typeof QUICK)[number]["key"] | "elle";

export default function NewOrder() {
  const { api } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const [cari, setCari] = useState<Picked | null>(null);
  const [doviz, setDoviz] = useState<Currency>("TRY");
  const [termin, setTermin] = useState("");
  const [quick, setQuick] = useState<QuickKey>("elle");
  const [aciklama, setAciklama] = useState("");
  const [lines, setLines] = useState<Line[]>([EMPTY]);
  const [formError, setFormError] = useState<string | null>(null);
  const built = buildOrder({
    cariKartId: cari?.id ?? null, doviz, termin, aciklama,
    kalemler: lines.map((l): OrderLineInput => ({ urunId: l.urun?.id ?? null, renkId: l.renk?.id ?? null, miktar: l.miktar, birimFiyat: l.birimFiyat })),
  });
  const send = useCallback((id: string) => (built.ok ? api.inboxCreate(id, "SIPARIS", built.body) : Promise.reject(new Error(built.error))), [api, built]);
  const w = useWrite(send);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function pickQuick(k: QuickKey) {
    setQuick(k);
    const q = QUICK.find((x) => x.key === k);
    if (q) setTermin(fmtDayKey(addDaysToKey(factoryDayKey(), q.days)));
  }

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) router.replace({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: r.mesajId } } as never);
  }

  return (
    <Screen title="Yeni sipariş" module="siparisler" back>
      <View style={s.intro}>
        <IconChip domain="gelenKutusu" icon="paper-plane-outline" size={32} />
        <Text style={s.introText}>Sipariş fabrikaya gelen kutusundan iletilir; fabrika işleyince durumunu oradan izlersiniz.</Text>
      </View>

      <View style={s.card}>
        <View style={[s.stripe, { backgroundColor: t.domain.cariler.fg }]} />
        <Picker label="Cari" projection="cari-kart" value={cari} onChange={setCari} testID="cari-sec" />
        <Text style={s.label}>Para birimi</Text>
        <SegmentedControl items={CURRENCIES} value={doviz} onChange={setDoviz} testIDPrefix="doviz-" accessibilityLabel="Para birimi" />
      </View>

      <View style={s.card}>
        <View style={[s.stripe, { backgroundColor: t.domain.sevkiyat.fg }]} />
        <Text style={s.label}>Termin (isteğe bağlı)</Text>
        <View style={s.quickRow}>
          {QUICK.map((q) => {
            const on = quick === q.key;
            return (
              <Pressable key={q.key} testID={`termin-${q.key}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pickQuick(q.key)}
                style={({ pressed }) => [s.quick, on && { backgroundColor: t.tintContainer, borderColor: t.tintContainer }, pressed && { opacity: 0.8 }]}>
                <Text style={[s.quickText, { color: on ? t.tint : t.text }]}>{q.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field label="Tarih (GG.AA.YYYY)" value={termin} onChangeText={(v) => { setTermin(v); setQuick("elle"); }} keyboardType="numbers-and-punctuation" placeholder="31.12.2026" testID="termin-metin" />
      </View>

      <SectionHeader title="Kalemler" count={lines.length} domain="siparisler" />
      {lines.map((l, i) => (
        <View key={i} style={s.card} testID={`kalem-${i}`}>
          <View style={[s.stripe, { backgroundColor: t.domain.siparisler.fg }]} />
          <View style={s.lineHead}>
            <View style={s.lineNo}><Text style={s.lineNoText}>{i + 1}</Text></View>
            <Text style={s.lineTitle} numberOfLines={1}>{l.urun?.title ?? "Yeni kalem"}</Text>
            {lines.length > 1 ? (
              <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${i + 1}. kalemi çıkar`} testID={`kalem-cikar-${i}`} style={s.remove}>
                <Ionicons name="trash-outline" size={18} color={t.status.kritik.fill} />
              </Pressable>
            ) : null}
          </View>
          <Picker label="Ürün" projection="urun" value={l.urun} onChange={(v) => setLine(i, { urun: v })} />
          <Picker label="Renk" projection="renk" value={l.renk} onChange={(v) => setLine(i, { renk: v })} optional />
          <View style={s.pair}>
            <View style={s.flex}><Field label="Miktar" value={l.miktar} onChangeText={(v) => setLine(i, { miktar: v })} keyboardType="decimal-pad" placeholder="0" /></View>
            <View style={s.flex}><Field label={`Birim fiyat (${CURRENCIES.find((c) => c.key === doviz)?.label ?? doviz})`} value={l.birimFiyat} onChangeText={(v) => setLine(i, { birimFiyat: v })} keyboardType="decimal-pad" placeholder="İsteğe bağlı" /></View>
          </View>
        </View>
      ))}
      <Button label="Kalem ekle" tone="secondary" icon="add-circle-outline" onPress={() => setLines((ls) => [...ls, EMPTY])} testID="kalem-ekle" />

      <SectionHeader title="Not" />
      <Field label="Açıklama (isteğe bağlı)" value={aciklama} onChangeText={setAciklama} multiline />

      {formError || w.error ? <Banner tone="error" text={formError ?? w.error ?? ""} /> : null}
      <View style={s.submit}>
        <Button label="Fabrikaya gönder" icon="paper-plane-outline" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="siparis-gonder" />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  intro: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, marginBottom: space.m },
  introText: { ...typography.subhead, color: t.textSecondary, flex: 1 },
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, marginBottom: space.m, overflow: "hidden" as const, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginBottom: space.xs },
  quickRow: { flexDirection: "row" as const, gap: space.s, marginBottom: space.m, flexWrap: "wrap" as const },
  quick: { minHeight: 36, paddingHorizontal: space.m, borderRadius: radius.chip, borderWidth: 1, borderColor: t.separator, justifyContent: "center" as const },
  quickText: { ...typography.subhead, fontWeight: "600" as const },
  lineHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginBottom: space.m },
  lineNo: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.domain.siparisler.chip, alignItems: "center" as const, justifyContent: "center" as const },
  lineNoText: { ...typography.footnote, fontWeight: "700" as const, color: t.domain.siparisler.fg },
  lineTitle: { ...typography.headline, color: t.text, flex: 1 },
  remove: { width: TOUCH - 12, height: TOUCH - 12, alignItems: "center" as const, justifyContent: "center" as const },
  pair: { flexDirection: "row" as const, gap: space.m },
  flex: { flex: 1 },
  submit: { marginTop: space.s },
}));
