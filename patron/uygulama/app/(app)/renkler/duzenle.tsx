// Renk düzenleme (V5c, ERP): açılışta GERÇEK kayıt okunur (sürüm = `updatedAt`), kaydette yalnız fark + `expectedUpdatedAt`.
// 409 STALE_RECORD'da form korunur, "Yenile" yeni sürümü alır (cari ile aynı akış). Pasife alma iki adımlı; canlı
// referanslı renk fabrikada reddedilir, ileti aynen gösterilir.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import type { RenkKaydi } from "../../../src/api/yazma";
import { farkSatirlari, renkFormu, renkPatch, surumluKaydet, type RenkFormu } from "../../../src/lib/duzenleme";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, Card, ConfirmButton, Field, Muted } from "../../../src/ui/kit";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

const ETIKET: Partial<Record<keyof RenkFormu, string>> = { ad: "Ad", hex: "Renk kodu" };

export default function EditColor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const s = useStyles();
  const izin = islemVar("renk.duzenle", permissions);
  const pasifIzni = islemVar("renk.pasif", permissions);
  const [kayit, setKayit] = useState<RenkKaydi | null>(null);
  const [form, setForm] = useState<RenkFormu | null>(null);
  const [taze, setTaze] = useState<RenkKaydi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const k = await yazici.renkOku(String(id));
      setKayit(k);
      setForm((f) => f ?? renkFormu(k));
      setTaze(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen sheet title="Renk düzenle" module="renkler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;
  const set = (p: Partial<RenkFormu>) => setForm((f) => (f ? { ...f, ...p } : f));

  async function kaydet() {
    if (!kayit || !form || offline) return;
    const b = renkPatch(kayit, form);
    if (!b.ok) return setError(b.error);
    if (Object.keys(b.body).length === 0) return setInfo("Değişiklik yok");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await surumluKaydet({
        yaz: () => yazici.renkGuncelle(kayit.id, kayit.surum, b.body),
        oku: () => yazici.renkOku(kayit.id),
        farkVar: (k) => { const p = renkPatch(k, form); return !p.ok || Object.keys(p.body).length > 0; },
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") return setTaze(r.taze);
      haptic("success");
      invalidate(["renk"]);
      router.back();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function pasifeAl() {
    if (!kayit || offline) return;
    setBusy(true);
    setError(null);
    try {
      await yazici.renkPasif(kayit.id);
      invalidate(["renk"]);
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fark = taze && form ? farkSatirlari(form, renkFormu(taze), ETIKET) : [];
  return (
    <Screen sheet title={kayit ? `${kayit.kod} düzenle` : "Renk düzenle"} module="renkler" back>
      {!kayit && !loadError ? <LoadingSkeleton rows={2} /> : null}
      {loadError && !kayit ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {kayit && form ? (
        <>
          {taze ? (
            <View style={s.stale} testID="bayat-kayit">
              <Banner tone="warn" text="Kayıt siz bakarken değişti" />
              {fark.map((x) => <Text key={x} style={s.meta}>{x}</Text>)}
              <Text style={s.meta}>Yazdıklarınız duruyor; yenileyip tekrar kaydedin.</Text>
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={() => { setKayit(taze); setTaze(null); }} testID="bayat-yenile" />
            </View>
          ) : null}
          <Card domain="uretim">
            <Field label="Ad" value={form.ad} onChangeText={(v) => set({ ad: v })} testID="renk-ad" />
            <Field label="Renk kodu" value={form.hex} onChangeText={(v) => set({ hex: v })} testID="renk-hex" placeholder="#RRGGBB" autoCapitalize="characters" />
            {!kayit.aktif ? <Text style={s.meta}>Bu renk pasif.</Text> : null}
          </Card>
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="kaydet-hata" /> : null}
          {info ? <Muted testID="kaydet-bilgi">{info}</Muted> : null}
          <View style={s.actions}>
            <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null} onPress={() => void kaydet()} testID="renk-kaydet" />
            {pasifIzni && kayit.aktif ? (
              <ConfirmButton label="Pasife al" question="Renk pasife alınsın mı? Kullanımda olan renk pasife alınamaz." busy={busy} disabled={offline} onConfirm={() => void pasifeAl()} testID="renk-pasif" />
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  stale: { gap: space.xs, marginBottom: space.m },
  meta: { ...typography.footnote, color: t.textSecondary },
  actions: { gap: space.s },
}));
