// Sipariş kalemleri (ERP): miktar · birim fiyat · renk değişir, kalem eklenir; kaldırmak = kalem iptali (ayrı ekran).
// Fabrika diziyi tam değiştirir → her mevcut kalem kayıtlı alanlarıyla geri gider (`lib/kalem.ts`). Sürüm
// `contentUpdatedAt` her yazımda gider: bayatta form KORUNUR, belirsiz denemeden sonraki STALE'de taze kayıt formla
// aynıysa ilk deneme yazılmıştır. Kısmi sevk / üretim / kapalı siparişte kalemler salt okunur, iptal açık kalır.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../../src/api/client";
import { islemVar } from "../../../../src/api/yetenek";
import { surumluKaydet } from "../../../../src/lib/duzenleme";
import { formatNumber } from "../../../../src/lib/format";
import { formuTazele, kalemDizisi, kalemFarkVar, kalemSatirlari, KILIT_ILETISI, type KalemDurumu, type KalemSatiri } from "../../../../src/lib/kalem";
import { unitLabel } from "../../../../src/lib/labels/siparis";
import { invalidate } from "../../../../src/state/changes";
import { useSession } from "../../../../src/state/session";
import { Screen } from "../../../../src/ui/Frame";
import { haptic } from "../../../../src/ui/haptics";
import { Banner, Button, Field, Muted } from "../../../../src/ui/kit";
import { Picker } from "../../../../src/ui/Picker";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { ErrorState, LoadingSkeleton } from "../../../../src/ui/StateViews";
import { makeStyles, useTokens } from "../../../../src/ui/theme-context";
import { STRIPE, radius, space, typography } from "../../../../src/ui/tokens";

const BOS: KalemSatiri = { urunId: null, urunAdi: "", renkId: null, renkAdi: "", miktar: "", birimFiyat: "" };

export default function OrderLinesEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const izin = islemVar("siparis.kalem", permissions);
  const iptalIzni = islemVar("siparis.kalem-iptal", permissions);
  const [kayit, setKayit] = useState<KalemDurumu | null>(null);
  const [form, setForm] = useState<KalemSatiri[] | null>(null);
  const [taze, setTaze] = useState<KalemDurumu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const k = await yazici.kalemleriOku(String(id));
      setKayit(k);
      setForm((f) => f ?? kalemSatirlari(k));
      setTaze(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if ((izin || iptalIzni) && id) void oku();
  }, [izin, iptalIzni, id, oku]);

  if (!izin && !iptalIzni) return <Screen sheet title="Kalemler" module="siparisler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;
  const setSatir = (i: number, p: Partial<KalemSatiri>) => setForm((f) => (f ? f.map((x, j) => (j === i ? { ...x, ...p } : x)) : f));
  const surum = kayit?.siparis.surum ?? null;
  const yazilabilir = izin && kayit !== null && kayit.kilit === null && surum !== null;

  async function kaydet() {
    if (!kayit || !form || offline || surum === null) return;
    const b = kalemDizisi(kayit, form);
    if (!b.ok) return setError(b.error);
    if (!b.body.degisti) return setInfo("Değişiklik yok");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await surumluKaydet({
        yaz: () => yazici.kalemleriYaz(kayit.siparis.id, surum, b.body.lines),
        oku: () => yazici.kalemleriOku(kayit.siparis.id),
        farkVar: (k) => kalemFarkVar(k, form),
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") return setTaze(r.taze);
      haptic("success");
      invalidate(["siparis", "siparis-kalemi", "ozet.siparis"]);
      router.back();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const iptalEt = (kalemId: string) => router.push({ pathname: "/siparisler/kalem-iptal", params: { id: String(id), kalem: kalemId } } as never);
  const iptalAcik = iptalIzni && kayit !== null && kayit.kilit !== "KAPALI";
  const kayitli = (kid?: string) => (kid ? kayit?.kalemler.find((k) => k.id === kid) : undefined);
  return (
    <Screen sheet title={kayit?.siparis.no ? `${kayit.siparis.no} kalemleri` : "Kalemler"} module="siparisler" back>
      {!kayit && !loadError ? <LoadingSkeleton rows={3} /> : null}
      {loadError && !kayit ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {kayit && form ? (
        <>
          {taze ? (
            <View style={s.stale} testID="bayat-kayit">
              <Banner tone="warn" text="Kalemler siz bakarken değişti" />
              <Text style={s.meta}>Yazdıklarınız duruyor; yenileyip tekrar kaydedin.</Text>
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={() => { setForm(formuTazele(form, taze)); setKayit(taze); setTaze(null); }} testID="bayat-yenile" />
            </View>
          ) : null}
          {kayit.kilit ? <Banner tone="warn" text={KILIT_ILETISI[kayit.kilit]} testID={`kilit-${kayit.kilit}`} /> : null}
          {izin && kayit.kilit === null && surum === null ? <Banner tone="warn" text="Bu sunucu kalem düzenlemeyi henüz desteklemiyor; fabrika sunucusu güncellenmeli" testID="surumsuz" /> : null}
          <SectionHeader title="Kalemler" count={form.length} domain="siparisler" />
          {form.map((f, i) => {
            const k = kayitli(f.id);
            return (
              <View key={f.id ?? `yeni-${i}`} style={s.card} testID={f.id ? `kalem-${f.id}` : `yeni-kalem-${i}`}>
                <View style={[s.stripe, { backgroundColor: t.domain.siparisler.fg }]} />
                <Text style={s.title} numberOfLines={1}>{f.id ? f.urunAdi || "—" : "Yeni kalem"}</Text>
                {k && Number(k.sevk) > 0 ? <Text style={s.meta}>{`Sevk ${formatNumber(k.sevk)} ${unitLabel(k.birim)}`}</Text> : null}
                {yazilabilir ? (
                  <>
                    {!f.id ? <Picker label="Ürün" projection="urun" value={f.urunId ? { id: f.urunId, title: f.urunAdi } : null} onChange={(v) => setSatir(i, { urunId: v?.id ?? null, urunAdi: v?.title ?? "" })} /> : null}
                    <Picker label="Renk" projection="renk" value={f.renkId ? { id: f.renkId, title: f.renkAdi || "Seçili renk" } : null} onChange={(v) => setSatir(i, { renkId: v?.id ?? null, renkAdi: v?.title ?? "" })} optional />
                    <View style={s.pair}>
                      <View style={s.flex}><Field label="Miktar" value={f.miktar} onChangeText={(v) => setSatir(i, { miktar: v })} keyboardType="decimal-pad" testID={`miktar-${i}`} /></View>
                      <View style={s.flex}><Field label={`Birim fiyat (${kayit.siparis.doviz})`} value={f.birimFiyat} onChangeText={(v) => setSatir(i, { birimFiyat: v })} keyboardType="decimal-pad" placeholder="İsteğe bağlı" testID={`fiyat-${i}`} /></View>
                    </View>
                    {!f.id ? <Button label="Bu satırı çıkar" tone="secondary" icon="trash-outline" onPress={() => setForm((x) => (x ? x.filter((_, j) => j !== i) : x))} testID={`yeni-cikar-${i}`} /> : null}
                  </>
                ) : (
                  <Text style={s.meta}>{[f.renkAdi ? `Renk ${f.renkAdi}` : null, `${formatNumber(f.miktar)} ${unitLabel(k?.birim)}`, f.birimFiyat ? `${formatNumber(f.birimFiyat)} ${kayit.siparis.doviz}` : null].filter(Boolean).join(" · ")}</Text>
                )}
                {f.id && iptalAcik ? <Button label="Kalemi iptal et" tone="danger" icon="close-circle-outline" disabled={offline} onPress={() => iptalEt(f.id!)} testID={`kalem-iptal-${f.id}`} /> : null}
              </View>
            );
          })}
          {yazilabilir ? <Button label="Kalem ekle" tone="secondary" icon="add-circle-outline" onPress={() => setForm((x) => [...(x ?? []), BOS])} testID="kalem-ekle" /> : null}
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="kaydet-hata" /> : null}
          {info ? <Muted testID="kaydet-bilgi">{info}</Muted> : null}
          {yazilabilir ? <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null} onPress={() => void kaydet()} testID="kalem-kaydet" /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, marginBottom: space.m, gap: space.s, overflow: "hidden" as const, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  stale: { gap: space.xs, marginBottom: space.m },
  title: { ...typography.headline, color: t.text },
  meta: { ...typography.footnote, color: t.textSecondary },
  pair: { flexDirection: "row" as const, gap: space.m },
  flex: { flex: 1 },
}));
