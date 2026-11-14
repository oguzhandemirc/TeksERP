// Ürün fiyatları (V5c, ERP): yürürlükteki satırlar (kart fiyatı + cari istisnaları); ekle/düzenle tek form, fabrika
// upsert eder. Sürüm = anahtarın görülen satırı (yoksa gönderilmez); 409 STALE_RECORD'da form korunur, "Yenile" taze
// satırı alır. Ticaret modülü kapalıysa fabrikanın reddi aynen gösterilir. Fiyat listesi belgesi telefonda yok.
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import type { FiyatKaydi } from "../../../src/api/yazma";
import { surumluKaydet } from "../../../src/lib/duzenleme";
import {
  BOS_FIYAT, FIYAT_DOVIZLERI, FIYAT_YONLERI, anahtarSatiri, ayniFiyat, fiyatBasligi, fiyatDegeri, fiyatFormu, fiyatGovdesi, type FiyatFormu,
} from "../../../src/lib/fiyat";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, Card, Field, Muted } from "../../../src/ui/kit";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { Picker } from "../../../src/ui/Picker";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { QuickChip } from "../../../src/ui/siparis/parts";
import { ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

/** Form kipi: kapalı · yeni anahtar · var olan satırın fiyatı (anahtar sabit). */
type Kip = { readonly tur: "yok" } | { readonly tur: "yeni" } | { readonly tur: "duzenle"; readonly satir: FiyatKaydi };

export default function ItemPrices() {
  const { id, ad } = useLocalSearchParams<{ id: string; ad?: string }>();
  const { yazici, permissions, offline } = useSession();
  const s = useStyles();
  const izin = islemVar("fiyat.yaz", permissions);
  const urunId = String(id);
  const [list, setList] = useState<FiyatKaydi[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kip, setKip] = useState<Kip>({ tur: "yok" });
  const [form, setForm] = useState<FiyatFormu>(BOS_FIYAT);
  // Bayat koruma tabanı: kullanıcının GÖRDÜĞÜ satır (STALE sonrası "Yenile" bunu taze satırla değiştirir).
  const [taban, setTaban] = useState<FiyatKaydi | null>(null);
  const [taze, setTaze] = useState<{ satir: FiyatKaydi | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      setList(await yazici.fiyatlar(urunId));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, urunId]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen sheet title="Fiyatlar" module="urunler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  const ac = (k: Kip) => {
    setKip(k);
    setForm(k.tur === "duzenle" ? fiyatFormu(k.satir) : BOS_FIYAT);
    setTaban(k.tur === "duzenle" ? k.satir : null);
    setTaze(null);
    setError(null);
    belirsiz.current = false;
  };
  const set = (p: Partial<FiyatFormu>) => setForm((f) => ({ ...f, ...p }));

  async function kaydet() {
    if (offline || busy) return;
    const b = fiyatGovdesi(urunId, form);
    if (!b.ok) return setError(b.error);
    // Yeni kipte aynı anahtar listede varsa o satırın sürümü gider (kullanıcının görmediği fiyat ezilmez).
    const gorulen = kip.tur === "duzenle" ? taban : taban ?? anahtarSatiri(list ?? [], form);
    setBusy(true);
    setError(null);
    try {
      const r = await surumluKaydet<FiyatKaydi | null>({
        yaz: async () => { await yazici.fiyatYaz(b.body, gorulen?.surum ?? null); return null; },
        oku: async () => anahtarSatiri(await yazici.fiyatlar(urunId), form),
        farkVar: (k) => !k || !ayniFiyat(k.fiyat, b.body.fiyat),
        belirsizOnce: belirsiz.current,
      });
      belirsiz.current = false;
      if (r.tur === "bayat") return setTaze({ satir: r.taze });
      haptic("success");
      setKip({ tur: "yok" });
      await oku();
    } catch (err) {
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const acik = kip.tur !== "yok";
  return (
    <Screen sheet title={ad ? `${ad} fiyatları` : "Fiyatlar"} module="urunler" back onRefresh={() => void oku()}>
      {list === null && !loadError ? <LoadingSkeleton rows={2} /> : null}
      {loadError && list === null ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {list !== null ? (
        <>
          {list.length > 0 ? (
            <ListGroup testID="fiyat-listesi">
              {list.map((k) => (
                <ListRow key={k.id} title={fiyatBasligi(k)} value={fiyatDegeri(k)} icon="pricetag-outline" domain="finans" testID={`fiyat-${k.id}`} onPress={() => ac({ tur: "duzenle", satir: k })} />
              ))}
            </ListGroup>
          ) : <Muted testID="fiyat-bos">Fiyat yok</Muted>}
          {!acik ? <Button label="Fiyat ekle" tone="secondary" icon="add-circle-outline" onPress={() => ac({ tur: "yeni" })} testID="fiyat-ekle" /> : null}
        </>
      ) : null}
      {acik ? (
        <>
          <SectionHeader title={kip.tur === "duzenle" ? fiyatBasligi(kip.satir) : "Yeni fiyat"} domain="finans" />
          {taze ? (
            <View style={s.stale} testID="bayat-kayit">
              <Banner tone="warn" text="Fiyat siz bakarken değişti" />
              <Text style={s.meta}>{`Fiyat: ${taze.satir ? fiyatDegeri(taze.satir) : "kaldırılmış"}`}</Text>
              <Text style={s.meta}>Yazdıklarınız duruyor; yenileyip tekrar kaydedin.</Text>
              <Button label="Yenile" tone="secondary" icon="refresh" onPress={() => { setTaban(taze.satir); setTaze(null); }} testID="bayat-yenile" />
            </View>
          ) : null}
          <Card domain="finans">
            {kip.tur === "yeni" ? (
              <>
                <View style={s.chips}>
                  {FIYAT_YONLERI.map((y) => <QuickChip key={y.key} label={y.label} selected={form.yon === y.key} onPress={() => set({ yon: y.key })} testID={`fiyat-yon-${y.key}`} />)}
                </View>
                <View style={s.chips}>
                  {FIYAT_DOVIZLERI.map((d) => <QuickChip key={d} label={d} selected={form.doviz === d} onPress={() => set({ doviz: d })} testID={`fiyat-doviz-${d}`} />)}
                </View>
                <Picker label="Cari (boşsa kart fiyatı)" projection="cari-kart" optional value={form.cariId ? { id: form.cariId, title: form.cariAdi } : null} onChange={(v) => set({ cariId: v?.id ?? null, cariAdi: v?.title ?? "" })} testID="fiyat-cari" />
              </>
            ) : null}
            <Field label={`Fiyat (${form.doviz})`} value={form.fiyat} onChangeText={(v) => set({ fiyat: v })} keyboardType="decimal-pad" placeholder="0" testID="fiyat-deger" />
          </Card>
          {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
          {error ? <Banner tone="error" text={error} testID="fiyat-hata" /> : null}
          <View style={s.actions}>
            <Button label={belirsiz.current && error ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={busy} disabled={offline || taze !== null} onPress={() => void kaydet()} testID="fiyat-kaydet" />
            <Button label="Vazgeç" tone="plain" onPress={() => ac({ tur: "yok" })} testID="fiyat-vazgec" />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  stale: { gap: space.xs, marginBottom: space.m },
  meta: { ...typography.footnote, color: t.textSecondary },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.xs, marginBottom: space.s },
  actions: { gap: space.s, marginTop: space.m },
}));
