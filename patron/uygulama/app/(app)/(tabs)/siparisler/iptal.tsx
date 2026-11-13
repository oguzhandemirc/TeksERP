// Sipariş iptali (ERP): önce fabrikanın önizlemesi, etkilenen HER kayıt listelenir. Üretimdeki siparişte her iş emri
// için eylem fabrikanın izinli listesinden kayıt başına seçilir (öneri önceden seçili); seçimsiz İE ile istek gitmez.
// Aktif sevkiyat varsa iptal yok. Temiz siparişte iki adımlı onay; yazıcı uygulamadan hemen önce önizlemeyi yeniden okur,
// iptal görülen önizlemenin belirteciyle gider: tutmazsa (409 CANCEL_PREVIEW_STALE) yeni önizleme gösterilir, onay BAŞTAN.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, errorMessage } from "../../../../src/api/client";
import { islemVar } from "../../../../src/api/yetenek";
import { eylemEtiketi } from "../../../../src/api/kalem-yazma";
import { CANCEL_PREVIEW_STALE, IPTAL_ILETISI, iptalKarari, type IptalOnizleme, type IsEmriEylemi } from "../../../../src/api/yazma";
import { formatNumber, statusLabel } from "../../../../src/lib/format";
import { TERIM } from "../../../../src/lib/terim";
import { invalidate } from "../../../../src/state/changes";
import { useSession } from "../../../../src/state/session";
import { Screen } from "../../../../src/ui/Frame";
import { haptic } from "../../../../src/ui/haptics";
import { Banner, Button, ConfirmButton, Muted } from "../../../../src/ui/kit";
import { SegmentedControl } from "../../../../src/ui/SegmentedControl";
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
  const [degisti, setDegisti] = useState(false);
  // Onay düğmesinin anahtarı: bayat önizlemeden sonra iki adımlı onay yeniden kurulur.
  const [onayTuru, setOnayTuru] = useState(0);
  const [secim, setSecim] = useState<Readonly<Record<string, IsEmriEylemi>>>({});
  const belirsiz = useRef(false);

  const oku = useCallback(async () => {
    setLoadError(null);
    try {
      const o = await yazici.siparisIptalOnizleme(String(id));
      setOnizleme(o);
      // Her yeni önizlemede seçim fabrikanın önerisiyle baştan kurulur (eski seçim yeni İE kümesine taşınmaz).
      setSecim(Object.fromEntries(o.isEmirleri.flatMap((w) => (w.varsayilan ? [[w.id, w.varsayilan]] : []))));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [yazici, id]);

  useEffect(() => {
    if (izin && id) void oku();
  }, [izin, id, oku]);

  if (!izin) return <Screen title="Sipariş iptali" module="siparisler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  async function iptalEt() {
    if (offline || !onizleme) return;
    setBusy(true);
    setError(null);
    try {
      const eylemler = onizleme.isEmirleri.length > 0 ? Object.entries(secim).map(([isEmriId, eylem]) => ({ isEmriId, eylem })) : undefined;
      await (eylemler ? yazici.siparisIptal(String(id), onizleme.belirtec, eylemler) : yazici.siparisIptal(String(id), onizleme.belirtec));
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
      if (err instanceof ApiError && err.code === CANCEL_PREVIEW_STALE) {
        // Hiçbir şey uygulanmadı: eski önizleme kaldırılır (eski belirteçle onay verilemez), yenisi gelince onay baştan.
        belirsiz.current = false;
        setOnizleme(null);
        setDegisti(true);
        setOnayTuru((n) => n + 1);
        await oku();
        return;
      }
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      setError(errorMessage(err));
      void oku();
    } finally {
      setBusy(false);
    }
  }

  const karar = onizleme ? iptalKarari(onizleme) : null;
  // Eski fabrika izinli eylemleri bildirmez → seçim yapılamaz, telefonda iptal yok.
  const secilebilir = karar === "URETIMDE" && onizleme!.isEmirleri.every((w) => w.izinli.length > 0);
  const onaylanabilir = karar === "SERBEST" || secilebilir;
  return (
    <Screen title={onizleme?.siparisNo ? `${onizleme.siparisNo} iptal` : "Sipariş iptali"} module="siparisler" back>
      {!onizleme && !loadError ? <LoadingSkeleton rows={3} /> : null}
      {loadError && !onizleme ? <ErrorState text={loadError} onRetry={() => void oku()} /> : null}
      {onizleme && karar ? (
        <>
          {degisti ? <Banner tone="warn" text={`Sipariş siz bakarken değişti; güncel durum aşağıda.${onaylanabilir ? " Yeniden onaylayın." : ""}`} testID="iptal-degisti" /> : null}
          <SectionHeader title="Etkilenen kayıtlar" />
          <FactGroup testID="iptal-etkilenen">
            <FactRow label="Sipariş" value={onizleme.siparisNo || "—"} />
            {onizleme.isEmirleri.map((w) => (
              <FactRow key={w.id} label={`${TERIM.terbiyeIsEmri.tekil} ${w.no}`} value={`${statusLabel(w.durum)} · ${formatNumber(w.uretilenTop, 0)} top`} />
            ))}
            {onizleme.sevkiyatlar.map((x) => <FactRow key={x.no} label={`Sevkiyat ${x.no}`} value={statusLabel(x.durum)} tone="kritik" />)}
          </FactGroup>
          {secilebilir ? (
            <>
              <SectionHeader title={`Her ${TERIM.terbiyeIsEmri.tekilKucuk} için ne olacak`} />
              {onizleme.isEmirleri.map((w) => (
                <View key={w.id} style={s.eylem} testID={`eylem-${w.id}`}>
                  <Text style={s.eylemBaslik}>{`${w.no}${w.digerSiparisler.length > 0 ? ` · ${w.digerSiparisler.length} başka sipariş bağlı` : ""}`}</Text>
                  <SegmentedControl items={w.izinli.map((e) => ({ key: e, label: eylemEtiketi(e, TERIM.terbiyeIsEmri.cumleBasi.belirtme) }))} value={secim[w.id] ?? w.izinli[0]!} onChange={(v) => setSecim((x) => ({ ...x, [w.id]: v }))} testIDPrefix={`eylem-${w.id}-`} accessibilityLabel={`${w.no} için eylem`} />
                </View>
              ))}
            </>
          ) : null}
          {!onaylanabilir ? (
            <Banner tone="warn" text={karar === "URETIMDE" ? "Bu sunucu üretimdeki siparişin iptalini desteklemiyor; panelden iptal edin" : IPTAL_ILETISI[karar]} testID={`iptal-${karar}`} />
          ) : (
            <>
              <Text style={s.note}>{karar === "SERBEST" ? `Yalnız bu sipariş iptal edilir; bağlı ${TERIM.terbiyeIsEmri.tekilKucuk} yok.` : `Sipariş iptal edilir; her ${TERIM.terbiyeIsEmri.tekilKucuk} için seçtiğiniz uygulanır.`}</Text>
              {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
              {error ? <Banner tone="error" text={error} testID="iptal-hata" /> : null}
              {belirsiz.current && error ? (
                <Button label="Tekrar dene" tone="danger" busy={busy} disabled={offline} onPress={() => void iptalEt()} testID="iptal-tekrar" />
              ) : (
                <ConfirmButton key={onayTuru} label="Siparişi iptal et" question={`${onizleme.siparisNo || "Sipariş"} iptal edilsin mi? Bu işlem geri alınamaz.`} busy={busy} disabled={offline} onConfirm={() => void iptalEt()} testID="siparis-iptal" />
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
  eylem: { gap: space.xs, marginBottom: space.m },
  eylemBaslik: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary },
}));
