// Sipariş iptali (ERP): önce fabrikanın önizlemesi, etkilenen HER kayıt listelenir. İş emri taşıyan sipariş telefonda
// İPTAL EDİLMEZ (eylem kayıt başına panelde seçilir; boş eylem listesi sunucuda varsayılanı — stoğa çevirme — uygular).
// Aktif sevkiyat varsa iptal yok. Temiz siparişte iki adımlı onay; yazıcı uygulamadan hemen önce önizlemeyi yeniden okur.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../../src/api/client";
import { islemVar } from "../../../../src/api/yetenek";
import { IPTAL_ILETISI, iptalKarari, type IptalOnizleme } from "../../../../src/api/yazma";
import { formatNumber, statusLabel } from "../../../../src/lib/format";
import { TERIM } from "../../../../src/lib/terim";
import { invalidate } from "../../../../src/state/changes";
import { useSession } from "../../../../src/state/session";
import { Screen } from "../../../../src/ui/Frame";
import { haptic } from "../../../../src/ui/haptics";
import { Banner, Button, ConfirmButton, Muted } from "../../../../src/ui/kit";
import { FactGroup, FactRow } from "../../../../src/ui/siparis/parts";
import { SectionHeader } from "../../../../src/ui/SectionHeader";
import { ErrorState, LoadingSkeleton } from "../../../../src/ui/StateViews";
import { makeStyles } from "../../../../src/ui/theme-context";
import { space, typography } from "../../../../src/ui/tokens";

export default function CancelOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const s = useStyles();
  const izin = islemVar("siparis.iptal", permissions);
  const [onizleme, setOnizleme] = useState<IptalOnizleme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      setOnizleme(await yazici.siparisIptalOnizleme(String(id)));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen title="Sipariş iptali" module="siparisler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  async function iptalEt() {
    if (offline) return;
    setBusy(true);
    setError(null);
    try {
      await yazici.siparisIptal(String(id));
      belirsiz.current = false;
      haptic("success");
      invalidate(["siparis", "ozet.siparis"]);
      router.back();
    } catch (err) {
      // Belirsiz denemeden sonra 409: ilk deneme işlemiş olabilir — kaydın durumunu yeniden oku, iptalse başarı.
      if (belirsiz.current && err instanceof ApiError && err.status === 409) {
        const k = await yazici.siparisOku(String(id)).catch(() => null);
        if (k?.durum === "CANCELLED") {
          invalidate(["siparis", "ozet.siparis"]);
          router.back();
          return;
        }
      }
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
      void oku();
    } finally {
      setBusy(false);
    }
  }

  const karar = onizleme ? iptalKarari(onizleme) : null;
  return (
    <Screen title={onizleme?.siparisNo ? `${onizleme.siparisNo} iptal` : "Sipariş iptali"} module="siparisler" back>
      {!onizleme && !loadError ? <LoadingSkeleton rows={3} /> : null}
      {loadError && !onizleme ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {onizleme && karar ? (
        <>
          <SectionHeader title="Etkilenen kayıtlar" />
          <FactGroup testID="iptal-etkilenen">
            <FactRow label="Sipariş" value={onizleme.siparisNo || "—"} />
            {onizleme.isEmirleri.map((w) => (
              <FactRow key={w.id} label={`${TERIM.terbiyeIsEmri.tekil} ${w.no}`} value={`${statusLabel(w.durum)} · ${formatNumber(w.uretilenTop, 0)} top`} />
            ))}
            {onizleme.sevkiyatlar.map((x) => <FactRow key={x.no} label={`Sevkiyat ${x.no}`} value={statusLabel(x.durum)} tone="kritik" />)}
          </FactGroup>
          {karar !== "SERBEST" ? (
            <Banner tone="warn" text={IPTAL_ILETISI[karar]} testID={`iptal-${karar}`} />
          ) : (
            <>
              <Text style={s.note}>{`Yalnız bu sipariş iptal edilir; bağlı ${TERIM.terbiyeIsEmri.tekilKucuk} yok.`}</Text>
              {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
              {error ? <Banner tone="error" text={error} testID="iptal-hata" /> : null}
              {belirsiz.current && error ? (
                <Button label="Tekrar dene" tone="danger" busy={busy} disabled={offline} onPress={() => void iptalEt()} testID="iptal-tekrar" />
              ) : (
                <ConfirmButton label="Siparişi iptal et" question={`${onizleme.siparisNo || "Sipariş"} iptal edilsin mi? Bu işlem geri alınamaz.`} busy={busy} disabled={offline} onConfirm={() => void iptalEt()} testID="siparis-iptal" />
              )}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...typography.subhead, color: t.textSecondary, marginVertical: space.m },
}));
