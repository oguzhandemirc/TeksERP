// Ürün düzenleme (V5c, ERP): açılışta GERÇEK kart okunur (sürüm = `updatedAt`); telefonda yalnız ad değişir, kod/tür/
// birim salt okunur (fabrika kod ve türü değiştirmez). 409 STALE_RECORD'da form korunur, "Yenile" yeni sürümü alır.
// Pasife alma yaşam döngüsü kapısıdır (Tükenene kadar/Pasif) → panelde. Fiyatlar ayrı ekranda.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import type { UrunKaydi } from "../../../src/api/yazma";
import { surumluKaydet } from "../../../src/lib/duzenleme";
import { urunPatch, urunTuruEtiketi } from "../../../src/lib/urun";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, Card, Field, Muted } from "../../../src/ui/kit";
import { FactGroup, FactRow } from "../../../src/ui/siparis/parts";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

export default function EditItem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const s = useStyles();
  const izin = islemVar("urun.duzenle", permissions);
  const fiyat = islemVar("fiyat.yaz", permissions);
  const [kayit, setKayit] = useState<UrunKaydi | null>(null);
  const [ad, setAd] = useState<string | null>(null);
  const [taze, setTaze] = useState<UrunKaydi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const k = await yazici.urunOku(String(id));
      setKayit(k);
      setAd((a) => a ?? k.ad);
      setTaze(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen sheet title="Ürün düzenle" module="urunler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  async function kaydet() {
    if (!kayit || ad === null || offline) return;
    const b = urunPatch(kayit, ad);
    if (!b.ok) return setError(b.error);
    if (Object.keys(b.body).length === 0) return setInfo("Değişiklik yok");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await surumluKaydet({
        yaz: () => yazici.urunGuncelle(kayit.id, kayit.surum, b.body),
        oku: () => yazici.urunOku(kayit.id),
        farkVar: (k) => { const p = urunPatch(k, ad); return !p.ok || Object.keys(p.body).length > 0; },
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") return setTaze(r.taze);
      haptic("success");
      invalidate(["urun"]);
      router.back();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen sheet title={kayit ? `${kayit.kod} düzenle` : "Ürün düzenle"} module="urunler" back>
      {!kayit && !loadError ? <LoadingSkeleton rows={2} /> : null}
      {loadError && !kayit ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {kayit && ad !== null ? (
        <>
          {taze ? (
            <View style={s.stale} testID="bayat-kayit">
              <Banner tone="warn" text="Kayıt siz bakarken değişti" />
              {taze.ad !== ad ? <Text style={s.meta}>{`Ad: ${taze.ad}`}</Text> : null}
              <Text style={s.meta}>Yazdıklarınız duruyor; yenileyip tekrar kaydedin.</Text>
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={() => { setKayit(taze); setTaze(null); }} testID="bayat-yenile" />
            </View>
          ) : null}
          <FactGroup testID="urun-kunye">
            <FactRow label="Kod" value={kayit.kod || "—"} />
            <FactRow label="Tür" value={urunTuruEtiketi(kayit.tur) || kayit.tur || "—"} />
            <FactRow label="Birim" value={kayit.birim || "—"} />
            {!kayit.aktif ? <FactRow label="Durum" value="Pasif" /> : null}
          </FactGroup>
          <Card domain="stok">
            <Field label="Ad" value={ad} onChangeText={setAd} testID="urun-ad" />
          </Card>
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="kaydet-hata" /> : null}
          {info ? <Muted testID="kaydet-bilgi">{info}</Muted> : null}
          <View style={s.actions}>
            <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null} onPress={() => void kaydet()} testID="urun-kaydet" />
            {fiyat ? <Button label="Fiyatlar" tone="secondary" icon="pricetag-outline" onPress={() => router.push({ pathname: "/urunler/fiyat", params: { id: kayit.id, ad: kayit.ad } } as never)} testID="urun-fiyatlar" /> : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  stale: { gap: space.xs, marginBottom: space.m },
  meta: { ...typography.footnote, color: t.textSecondary },
  actions: { gap: space.s, marginTop: space.m },
}));
