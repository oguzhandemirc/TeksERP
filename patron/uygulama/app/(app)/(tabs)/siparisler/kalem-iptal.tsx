// Kalem iptali (ERP, soft): önce fabrikanın önizlemesi — kalem, iptal edilecek kalan, koparılacak HER iş emri bağı
// (stoğa dönecekse yazılı) ve son kalemse siparişin düşeceği durum. Engel varsa iptal yok (fabrikanın iletisi aynen).
// İki adımlı onay; iptal görülen önizlemenin belirteciyle gider: tutmazsa (409 CANCEL_PREVIEW_STALE) yeni önizleme,
// onay BAŞTAN. Belirsiz denemeden sonra hata: kalem yeniden okunur, iptal edilmişse başarı sayılır.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { ApiError, errorMessage } from "../../../../src/api/client";
import { islemVar } from "../../../../src/api/yetenek";
import { CANCEL_PREVIEW_STALE, type KalemIptalOnizleme } from "../../../../src/api/yazma";
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

export default function CancelOrderLine() {
  const { id, kalem } = useLocalSearchParams<{ id: string; kalem: string }>();
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const s = useStyles();
  const izin = islemVar("siparis.kalem-iptal", permissions);
  const [onizleme, setOnizleme] = useState<KalemIptalOnizleme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [degisti, setDegisti] = useState(false);
  const [onayTuru, setOnayTuru] = useState(0);
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      setOnizleme(await yazici.kalemIptalOnizleme(String(id), String(kalem)));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id, kalem]);

  useEffect(() => {
    if (izin && id && kalem) void oku();
  }, [izin, id, kalem, oku]);

  if (!izin) return <Screen sheet title="Kalem iptali" module="siparisler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  const bitti = () => {
    haptic("success");
    invalidate(["siparis", "siparis-kalemi", "ozet.siparis"]);
    router.back();
  };

  async function iptalEt() {
    if (offline || !onizleme) return;
    setBusy(true);
    setError(null);
    try {
      await yazici.kalemIptal(String(id), String(kalem), onizleme);
      belirsiz.current = false;
      bitti();
    } catch (err) {
      if (belirsiz.current && err instanceof ApiError && err.status >= 400 && err.status < 500) {
        const d = await yazici.kalemleriOku(String(id)).catch(() => null);
        if (d?.kalemler.find((k) => k.id === String(kalem))?.iptal) return bitti();
      }
      if (err instanceof ApiError && err.code === CANCEL_PREVIEW_STALE) {
        belirsiz.current = false;
        setOnizleme(null);
        setDegisti(true);
        setOnayTuru((n) => n + 1);
        await oku();
        return;
      }
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const o = onizleme;
  return (
    <Screen sheet title="Kalem iptali" module="siparisler" back>
      {!o && !loadError ? <LoadingSkeleton rows={3} /> : null}
      {loadError && !o ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {o ? (
        <>
          {degisti ? <Banner tone="warn" text="Kalem siz bakarken değişti; güncel durum aşağıda. Yeniden onaylayın." testID="kalem-iptal-degisti" /> : null}
          <SectionHeader title="Etkilenen kayıtlar" />
          <FactGroup testID="kalem-iptal-etkilenen">
            <FactRow label="Sipariş" value={o.siparisNo || "—"} />
            <FactRow label="Kalem" value={[o.urunAdi || "—", o.renkAdi || null].filter(Boolean).join(" · ")} />
            <FactRow label="İstenen" value={formatNumber(o.istenen)} />
            {o.sevk > 0 ? <FactRow label="Sevk edilen (geçerli kalır)" value={formatNumber(o.sevk)} /> : null}
            <FactRow label="İptal edilecek kalan" value={formatNumber(o.kalan)} tone="kritik" />
            {o.isEmirleri.map((w) => (
              <FactRow key={w.id} label={`${TERIM.terbiyeIsEmri.tekil} ${w.no}`} value={`${statusLabel(w.durum)} · bağ kopar${w.stogaDoner ? " · stok üretimine döner" : ""}`} />
            ))}
            {o.siparisSonDurum ? <FactRow label="Sipariş" value={`Son kalem — sipariş ${statusLabel(o.siparisSonDurum)} olur`} tone="kritik" /> : null}
          </FactGroup>
          {o.engeller.map((x) => <Banner key={x} tone="warn" text={x} testID="kalem-iptal-engel" />)}
          {o.iptalEdilebilir ? (
            <>
              <Text style={s.note}>Kalem silinmez; listede iptal olarak kalır.</Text>
              {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
              {error ? <Banner tone="error" text={error} testID="kalem-iptal-hata" /> : null}
              {belirsiz.current && error ? (
                <Button label="Tekrar dene" tone="danger" busy={busy} disabled={offline} onPress={() => void iptalEt()} testID="kalem-iptal-tekrar" />
              ) : (
                <ConfirmButton key={onayTuru} label="Kalemi iptal et" question="Kalem iptal edilsin mi? Bu işlem geri alınamaz." busy={busy} disabled={offline} onConfirm={() => void iptalEt()} testID="kalem-iptal-onay" />
              )}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...typography.subhead, color: t.textSecondary, marginVertical: space.m },
}));
