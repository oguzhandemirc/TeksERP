// Yeni sipariş fabrikaya GELEN KUTUSU üzerinden gider: sipariş no, yön, durum fabrikada doğar.
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { buildOrder, type OrderLineInput } from "../../../src/lib/forms";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Card, Field, Muted, Tabs, Title } from "../../../src/ui/kit";
import { Picker, type Picked } from "../../../src/ui/Picker";
import { useWrite } from "../../../src/ui/useWrite";

interface Line { urun: Picked | null; renk: Picked | null; miktar: string; birimFiyat: string }
const EMPTY: Line = { urun: null, renk: null, miktar: "", birimFiyat: "" };
const CURRENCIES = [{ key: "TRY", label: "TL" }, { key: "USD", label: "USD" }, { key: "EUR", label: "EUR" }] as const;

export default function NewOrder() {
  const { api } = useSession();
  const router = useRouter();
  const [cari, setCari] = useState<Picked | null>(null);
  const [doviz, setDoviz] = useState<"TRY" | "USD" | "EUR">("TRY");
  const [termin, setTermin] = useState("");
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

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) router.replace({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: r.mesajId } } as never);
  }

  return (
    <Screen title="Yeni sipariş" module="siparisler" back>
      <Muted>Sipariş fabrikaya gelen kutusundan iletilir; fabrika işleyince durumu buradan izlersiniz.</Muted>
      <Picker label="Cari" projection="cari-kart" value={cari} onChange={setCari} testID="cari-sec" />
      <Tabs items={CURRENCIES} value={doviz} onChange={setDoviz} />
      <Field label="Termin (GG.AA.YYYY, isteğe bağlı)" value={termin} onChangeText={setTermin} keyboardType="numbers-and-punctuation" />
      <Field label="Açıklama (isteğe bağlı)" value={aciklama} onChangeText={setAciklama} multiline />
      {lines.map((l, i) => (
        <Card key={i}>
          <Title>{`${i + 1}. kalem`}</Title>
          <Picker label="Ürün" projection="urun" value={l.urun} onChange={(v) => setLine(i, { urun: v })} />
          <Picker label="Renk" projection="renk" value={l.renk} onChange={(v) => setLine(i, { renk: v })} optional />
          <Field label="Miktar" value={l.miktar} onChangeText={(t) => setLine(i, { miktar: t })} keyboardType="decimal-pad" />
          <Field label="Birim fiyat (isteğe bağlı)" value={l.birimFiyat} onChangeText={(t) => setLine(i, { birimFiyat: t })} keyboardType="decimal-pad" />
          {lines.length > 1 ? <Button label="Kalemi çıkar" tone="plain" onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} /> : null}
        </Card>
      ))}
      <Button label="Kalem ekle" tone="plain" onPress={() => setLines((ls) => [...ls, EMPTY])} />
      {formError || w.error ? <Banner tone="error" text={formError ?? w.error ?? ""} /> : null}
      <View>
        <Button label="Fabrikaya gönder" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="siparis-gonder" />
      </View>
    </Screen>
  );
}
