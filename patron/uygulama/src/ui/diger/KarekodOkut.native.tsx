// Fabrika sunucusu bağlantı karekodu okutma (ERP kipi). Karekod yalnız adres taşır; okunan adres elle girişle AYNI
// yoldan (`connectServer`: https denetimi + `/api/client-policy/patron` yoklaması) geçer, giriş yine parolayla.
// Kamera izni reddinde elle girişe dönülür. Yalnız telefonda: web paketi kamerasız `KarekodOkut.tsx`i çözer
// (expo-camera'nın web kodu açılışta blob işçisi kurar → bulut CSP'si `worker-src 'self'` ihlali).
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { patronKarekoduOku } from "../../lib/patron-karekod";
import { KAMERA_IZNI_YOK, KAREKOD_ILETI, type KarekodOkutProps } from "./karekod-ileti";
import { useTokens } from "../theme-context";
import { AuthShell } from "./AuthShell";
import { Banner, Button } from "../kit";
import { radius, space } from "../tokens";

export { KAREKOD_ILETI, KAMERA_IZNI_YOK } from "./karekod-ileti";

export function KarekodOkut({ onAdres, onElle }: KarekodOkutProps) {
  const t = useTokens();
  const [izin, iste] = useCameraPermissions();
  const istendi = useRef(false);
  // Çağıran satır içi işlev verebilir: izin etkisi her çizimde yeniden koşmasın diye son sürüm ref'te.
  const elle = useRef(onElle);
  elle.current = onElle;
  // Kamera aynı kodu saniyede birçok kez bildirir: ilk okumadan sonra kullanıcı "Tekrar okut"a basana dek kilitli.
  const kilit = useRef(false);
  const [hata, setHata] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!izin || izin.granted) return;
    if (istendi.current || !izin.canAskAgain) {
      elle.current(KAMERA_IZNI_YOK);
      return;
    }
    istendi.current = true;
    void iste().then((r) => { if (!r.granted) elle.current(KAMERA_IZNI_YOK); }).catch(() => elle.current(KAMERA_IZNI_YOK));
  }, [izin, iste]);

  async function okundu(metin: string) {
    if (kilit.current) return;
    kilit.current = true;
    const k = patronKarekoduOku(metin);
    if (!k.tamam) {
      setHata(KAREKOD_ILETI[k.neden]);
      return;
    }
    setBusy(true);
    const msg = await onAdres(k.adres).catch(() => "Sunucuya ulaşılamıyor");
    setBusy(false);
    if (msg) setHata(msg);
  }

  function tekrar() {
    setHata(null);
    kilit.current = false;
  }

  return (
    <AuthShell title="Karekod okut" subtitle="Paneldeki Yetkilendirme → Patron Telefonu ekranında (ya da size gönderilen fotoğrafta) görünen karekodu çerçeveye getirin">
      {hata ? <Banner tone="error" text={hata} testID="karekod-hata" /> : null}
      <View style={{ height: 280, borderRadius: radius.card, overflow: "hidden", backgroundColor: t.navy, alignItems: "center", justifyContent: "center", marginBottom: space.s }}>
        {izin?.granted ? (
          <CameraView
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={hata || busy ? undefined : (r) => void okundu(r.data)}
            testID="karekod-kamera"
          />
        ) : null}
        {busy || !izin?.granted ? <ActivityIndicator color={t.onNavy.text} testID="karekod-bekle" /> : null}
      </View>
      {hata ? <Button label="Tekrar okut" icon="scan-outline" onPress={tekrar} testID="karekod-tekrar" /> : null}
      <Button label="Adresi elle yaz" tone="plain" icon="create-outline" onPress={() => onElle()} testID="karekod-elle" />
    </AuthShell>
  );
}
