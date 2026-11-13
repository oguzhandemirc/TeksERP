// Cari düzenleme (ERP): açılışta fabrikanın GERÇEK kaydı okunur (sürüm = `updatedAt`), kaydette yalnız değişen alanlar
// + `expectedUpdatedAt` gider. Kayıt arada değiştiyse (409 STALE_RECORD) form korunur, sunucudaki değerler gösterilir,
// "Yenile" yeni sürümü alır. Finans şartları telefonda yok. İşlem kapalıysa ekran uyarı çizer (doğrudan açılış).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import type { CariKaydi } from "../../../src/api/yazma";
import { cariFormu, cariPatch, farkSatirlari, surumluKaydet, type CariFormu } from "../../../src/lib/duzenleme";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, Field, Muted } from "../../../src/ui/kit";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { STRIPE, TOUCH, radius, space, typography } from "../../../src/ui/tokens";

const ETIKET: Partial<Record<keyof CariFormu, string>> = { ad: "Ad", musteri: "Müşteri", tedarikci: "Tedarikçi", il: "İl", vergiNo: "Vergi no", telefon: "Telefon", eposta: "E-posta" };

export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const izin = islemVar("cari.duzenle", permissions);
  const [kayit, setKayit] = useState<CariKaydi | null>(null);
  const [form, setForm] = useState<CariFormu | null>(null);
  const [taze, setTaze] = useState<CariKaydi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const k = await yazici.cariOku(String(id));
      setKayit(k);
      setForm((f) => f ?? cariFormu(k));
      setTaze(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen title="Cari düzenle" module="cariler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;
  const set = (p: Partial<CariFormu>) => setForm((f) => (f ? { ...f, ...p } : f));

  async function kaydet() {
    if (!kayit || !form || offline) return;
    const b = cariPatch(kayit, form);
    if (!b.ok) return setError(b.error);
    if (Object.keys(b.body).length === 0) return setInfo("Değişiklik yok");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await surumluKaydet({
        yaz: () => yazici.cariGuncelle(kayit.id, kayit.surum, b.body),
        oku: () => yazici.cariOku(kayit.id),
        farkVar: (k) => { const p = cariPatch(k, form); return !p.ok || Object.keys(p.body).length > 0; },
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") {
        setTaze(r.taze);
        return;
      }
      haptic("success");
      invalidate(["cari-kart"]);
      router.back();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Yeni sürümü benimse: form (kullanıcının yazdıkları) KALIR; sonraki kaydet bu sürümle gider. */
  function yenile() {
    if (taze) setKayit(taze);
    setTaze(null);
  }

  const fark = taze && form ? farkSatirlari(form, cariFormu(taze), ETIKET) : [];
  return (
    <Screen title={kayit ? `${kayit.kod} düzenle` : "Cari düzenle"} module="cariler" back>
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
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={yenile} testID="bayat-yenile" />
            </View>
          ) : null}
          <View style={s.card}>
            <View style={[s.stripe, { backgroundColor: t.domain.cariler.fg }]} />
            <Field label="Ad / unvan" value={form.ad} onChangeText={(v) => set({ ad: v })} testID="cari-ad" />
            <Text style={s.label}>Rol</Text>
            <View style={s.roles}>
              {(["musteri", "tedarikci"] as const).map((r) => (
                <Pressable key={r} onPress={() => set({ [r]: !form[r] })} testID={`rol-${r}`} accessibilityRole="checkbox" accessibilityState={{ checked: form[r] }}
                  style={[s.toggle, form[r] && { backgroundColor: t.domain.cariler.chip, borderColor: t.domain.cariler.fg }]}>
                  <Text style={[s.toggleText, { color: form[r] ? t.domain.cariler.fg : t.text }]}>{r === "musteri" ? "Müşteri" : "Tedarikçi"}</Text>
                </Pressable>
              ))}
            </View>
            {kayit.fason ? <Text style={s.meta}>Fason rolü panelden yönetilir.</Text> : null}
          </View>
          <View style={s.card}>
            <View style={[s.stripe, { backgroundColor: t.domain.genel.fg }]} />
            <Field label="İl" value={form.il} onChangeText={(v) => set({ il: v })} />
            <Field label="Vergi no" value={form.vergiNo} onChangeText={(v) => set({ vergiNo: v.replace(/\D/g, "") })} keyboardType="number-pad" />
            <Field label="Telefon" value={form.telefon} onChangeText={(v) => set({ telefon: v })} keyboardType="phone-pad" />
            <Field label="E-posta" value={form.eposta} onChangeText={(v) => set({ eposta: v })} autoCapitalize="none" keyboardType="email-address" />
          </View>
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="kaydet-hata" /> : null}
          {info ? <Muted testID="kaydet-bilgi">{info}</Muted> : null}
          <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null} onPress={() => void kaydet()} testID="cari-kaydet" />
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
  roles: { flexDirection: "row" as const, gap: space.s, flexWrap: "wrap" as const },
  toggle: { minHeight: TOUCH - 4, flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: space.m, borderRadius: radius.chip, borderWidth: 1, borderColor: t.separator },
  toggleText: { ...typography.callout, fontWeight: "600" as const },
}));
