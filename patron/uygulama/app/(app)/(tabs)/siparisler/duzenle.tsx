// Sipariş düzenleme (ERP) — YALNIZ BAŞLIK: cari · para birimi · termin (kısmi sevkte yalnız termin). Kalemler panelde:
// fabrika kalem dizisini tam değiştirir (gönderilmeyen kalem ve zorunlu özellik silinir). Açılışta gerçek ERP detayı
// okunur, sürüm `contentUpdatedAt` PATCH'te geri gider; sürümsüz (eski) sunucuda kaydet kapalı. STALE akışı caride olduğu gibi.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../../src/api/client";
import { islemVar } from "../../../../src/api/yetenek";
import type { SiparisKaydi } from "../../../../src/api/yazma";
import { farkSatirlari, siparisFormu, siparisPatch, surumluKaydet, yalnizTermin, type SiparisFormu } from "../../../../src/lib/duzenleme";
import { invalidate } from "../../../../src/state/changes";
import { useSession } from "../../../../src/state/session";
import { Screen } from "../../../../src/ui/Frame";
import { haptic } from "../../../../src/ui/haptics";
import { Banner, Button, Field, Muted } from "../../../../src/ui/kit";
import { Picker, type Picked } from "../../../../src/ui/Picker";
import { SegmentedControl } from "../../../../src/ui/SegmentedControl";
import { ErrorState, LoadingSkeleton } from "../../../../src/ui/StateViews";
import { makeStyles, useTokens } from "../../../../src/ui/theme-context";
import { STRIPE, radius, space, typography } from "../../../../src/ui/tokens";

const CURRENCIES = [{ key: "TRY", label: "TL ₺" }, { key: "USD", label: "USD $" }, { key: "EUR", label: "EUR €" }];
const ETIKET: Partial<Record<keyof SiparisFormu, string>> = { cariAdi: "Cari", doviz: "Para birimi", termin: "Termin" };

export default function EditOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const izin = islemVar("siparis.duzenle", permissions);
  const [kayit, setKayit] = useState<SiparisKaydi | null>(null);
  const [form, setForm] = useState<SiparisFormu | null>(null);
  const [taze, setTaze] = useState<SiparisKaydi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const k = await yazici.siparisOku(String(id));
      setKayit(k);
      setForm((f) => f ?? siparisFormu(k));
      setTaze(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen title="Sipariş düzenle" module="siparisler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;
  const set = (p: Partial<SiparisFormu>) => setForm((f) => (f ? { ...f, ...p } : f));
  const kapali = kayit !== null && (kayit.durum === "COMPLETED" || kayit.durum === "CANCELLED");
  const surumsuz = kayit !== null && kayit.surum === null;

  async function kaydet() {
    if (!kayit || !form || offline || kayit.surum === null) return;
    const surum = kayit.surum;
    const b = siparisPatch(kayit, form);
    if (!b.ok) return setError(b.error);
    if (Object.keys(b.body).length === 0) return setInfo("Değişiklik yok");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await surumluKaydet({
        yaz: () => yazici.siparisGuncelle(kayit.id, surum, b.body),
        oku: () => yazici.siparisOku(kayit.id),
        farkVar: (k) => { const p = siparisPatch(k, form); return !p.ok || Object.keys(p.body).length > 0; },
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") return setTaze(r.taze);
      haptic("success");
      invalidate(["siparis", "ozet.siparis"]);
      router.back();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fark = taze && form ? farkSatirlari(form, siparisFormu(taze), ETIKET) : [];
  const cari: Picked | null = form?.cariKartId ? { id: form.cariKartId, title: form.cariAdi || "Seçili cari" } : null;
  return (
    <Screen title={kayit?.no ? `${kayit.no} düzenle` : "Sipariş düzenle"} module="siparisler" back>
      {!kayit && !loadError ? <LoadingSkeleton rows={3} /> : null}
      {loadError && !kayit ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {kayit && form ? (
        <>
          {taze ? (
            <View style={s.stale} testID="bayat-kayit">
              <Banner tone="warn" text="Kayıt siz bakarken değişti" />
              {fark.length > 0 ? <Text style={s.meta}>Sunucuda şimdi:</Text> : null}
              {fark.map((x) => <Text key={x} style={s.meta}>{x}</Text>)}
              <Text style={s.meta}>Yazdıklarınız duruyor; yenileyip tekrar kaydedin.</Text>
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={() => { setKayit(taze); setTaze(null); }} testID="bayat-yenile" />
            </View>
          ) : null}
          {kapali ? <Banner tone="warn" text="Tamamlanmış ya da iptal edilmiş sipariş düzenlenemez" /> : null}
          {surumsuz ? <Banner tone="warn" text="Bu sunucu düzenlemeyi henüz desteklemiyor; fabrika sunucusu güncellenmeli" testID="surumsuz" /> : null}
          {!yalnizTermin(kayit) ? (
            <View style={s.card}>
              <View style={[s.stripe, { backgroundColor: t.domain.cariler.fg }]} />
              <Picker label="Cari" projection="cari-kart" value={cari} onChange={(v) => set({ cariKartId: v?.id ?? "", cariAdi: v?.title ?? "" })} testID="cari-sec" />
              <Text style={s.label}>Para birimi</Text>
              <SegmentedControl items={CURRENCIES} value={form.doviz} onChange={(v) => set({ doviz: v })} testIDPrefix="doviz-" accessibilityLabel="Para birimi" />
            </View>
          ) : <Muted>Kısmen sevk edilmiş siparişte yalnız termin değişir.</Muted>}
          <View style={s.card}>
            <View style={[s.stripe, { backgroundColor: t.domain.sevkiyat.fg }]} />
            <Field label="Termin" value={form.termin} onChangeText={(v) => set({ termin: v })} keyboardType="numbers-and-punctuation" placeholder="GG.AA.YYYY" testID="termin-metin" />
          </View>
          <Muted>{`Kalemler (${kayit.kalemSayisi}) panelden düzenlenir.`}</Muted>
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="kaydet-hata" /> : null}
          {info ? <Muted testID="kaydet-bilgi">{info}</Muted> : null}
          <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null || kapali || surumsuz} onPress={() => void kaydet()} testID="siparis-kaydet" />
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, marginBottom: space.m, overflow: "hidden" as const, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  stale: { gap: space.xs, marginBottom: space.m },
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginBottom: space.xs },
  meta: { ...typography.footnote, color: t.textSecondary },
}));
