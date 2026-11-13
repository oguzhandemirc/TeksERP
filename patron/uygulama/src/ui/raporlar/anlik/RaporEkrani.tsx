// Tek rapor: açılınca SON koşumun saklı sonucu; "Yeni oluştur" formu açar (varsayılan = son parametreler) → sunucu
// eşzamanlı hesaplar (≤60 sn) → sonuç. Deneme kimliği mantıksal deneme başına; belirsiz hatada yapışır ("Tekrar dene"
// aynı kimlikle), çift dokunuş tek istek. Çevrimdışıyken saklı sonuç görünür, oluşturma kapalı.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { createAttempt, runAttempt } from "../../../api/attempt";
import { ApiError } from "../../../api/client";
import type { RaporKosumuDetay } from "../../../api/rapor";
import { LISTEDEN_DUSUREN, formVarsayilani, raporHataIletisi } from "../../../lib/rapor-anlik";
import { rangeParamNames } from "../../../lib/reports";
import { invalidate } from "../../../state/changes";
import { useSession } from "../../../state/session";
import { useRemote } from "../../../state/useRemote";
import { Screen } from "../../Frame";
import { Banner, Button } from "../../kit";
import { Empty, ErrorState, LoadingSkeleton } from "../../StateViews";
import { makeStyles, useTokens } from "../../theme-context";
import { radius, space, typography } from "../../tokens";
import { KosumSonucu } from "./KosumSonucu";
import { KATALOG_KEY, RAPOR_TAGS } from "./Liste";
import { ParamForm } from "./ParamForm";

export const kosumKey = (id: string) => `rapor-anlik:kosum:${id}`;

export function AnlikRaporEkrani() {
  const { anahtar: raw } = useLocalSearchParams<{ anahtar?: string }>();
  const anahtar = String(raw ?? "");
  const { raporcu, cache, offline } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const k = useRemote(KATALOG_KEY, () => raporcu.katalog(), { tags: RAPOR_TAGS });
  const satir = k.data?.raporlar.find((r) => r.anahtar === anahtar);
  const [yeni, setYeni] = useState<RaporKosumuDetay | null>(null);
  const sonId = yeni ? null : (satir?.sonKosum?.id ?? null);
  const son = useRemote(sonId ? kosumKey(sonId) : null, () => raporcu.kosum(String(sonId)), { tags: RAPOR_TAGS });
  const shown = yeni ?? son.data;
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Record<string, string> | null>(null);
  const attempt = useRef(createAttempt());
  const lastBody = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function create(params: Record<string, string>) {
    if (inFlight.current || offline) return;
    const body = JSON.stringify(params);
    // Gövde değiştiyse yeni mantıksal deneme: kimlik yenilenir (aynı kimlik + farklı gövde sunucuda çakışma).
    if (lastBody.current !== body) attempt.current = createAttempt();
    lastBody.current = body;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setRetry(null);
    try {
      const r = await runAttempt(attempt.current, (id) => raporcu.olustur(id, anahtar, params));
      setYeni(r);
      setFormOpen(false);
      if (cache) await cache.load(kosumKey(r.id), () => Promise.resolve(r)).catch(() => undefined);
      invalidate(RAPOR_TAGS);
    } catch (err) {
      setError(raporHataIletisi(err));
      if (err instanceof ApiError && err.ambiguous) setRetry(params);
      if (err instanceof ApiError && LISTEDEN_DUSUREN.has(err.code)) k.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const refresh = () => {
    k.reload();
    if (sonId) son.reload();
  };
  const initial = formVarsayilani(shown?.parametreler ?? satir?.sonKosum?.parametreler, satir ? rangeParamNames(satir.parametreler) : null);

  return (
    <Screen title={satir?.baslik ?? "Rapor"} module="raporlar" back onRefresh={refresh} refreshing={k.refreshing || son.refreshing}>
      {k.loading && !k.data ? <LoadingSkeleton rows={4} /> : null}
      {k.error && !k.data ? <ErrorState text={k.error} onRetry={k.reload} /> : null}
      {k.data && !satir ? <Empty text="Bu rapor size açık değil" domain="raporlar" testID="rapor-yok" /> : null}
      {satir ? (
        <>
          <View style={s.actions}>
            <View style={s.flex}>
              <Button
                label="Yeni oluştur"
                icon="add-circle-outline"
                disabled={offline || busy}
                onPress={() => setFormOpen((o) => !o)}
                testID="rapor-yeni"
              />
            </View>
            <View style={s.flex}>
              <Button label="Oluşturulanlar" icon="time-outline" tone="plain" onPress={() => router.push({ pathname: "/raporlar/gecmis", params: { anahtar } } as never)} testID="rapor-gecmis" />
            </View>
          </View>
          {offline ? <Banner tone="off" icon="cloud-offline-outline" text="Sunucuya ulaşılamıyor" testID="rapor-cevrimdisi" /> : null}
          {formOpen && !offline ? <ParamForm parametreler={satir.parametreler} initial={initial} busy={busy} disabled={busy || offline} onSubmit={(p) => void create(p)} /> : null}
          {busy ? (
            <View style={[s.pending, { backgroundColor: t.status.bilgi.bg }]} testID="rapor-hazirlaniyor" accessibilityRole="progressbar">
              <ActivityIndicator color={t.status.bilgi.fill} />
              <Text style={[s.pendingText, { color: t.status.bilgi.text }]}>Rapor hazırlanıyor; bir dakikayı bulabilir.</Text>
            </View>
          ) : null}
          {error ? <Banner tone="error" text={error} testID="rapor-hata" /> : null}
          {retry && !busy ? <Button label="Tekrar dene" icon="refresh" tone="plain" disabled={offline} onPress={() => void create(retry)} testID="rapor-tekrar" /> : null}
          {sonId && son.loading && !son.data ? <LoadingSkeleton rows={3} /> : null}
          {sonId && son.error && !son.data ? <ErrorState text={son.error} onRetry={son.reload} /> : null}
          {!shown && !sonId && !busy ? <Empty text="Henüz oluşturulmadı" domain="raporlar" testID="rapor-bos" /> : null}
          {shown ? <KosumSonucu kosum={shown} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  actions: { flexDirection: "row" as const, gap: space.m, marginBottom: space.m },
  flex: { flex: 1 },
  pending: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, padding: space.m, borderRadius: radius.cardInner, marginVertical: space.m },
  pendingText: { ...typography.subhead, flex: 1 },
}));
