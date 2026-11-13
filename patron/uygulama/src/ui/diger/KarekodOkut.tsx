// Karekod okutmanın kamerasız sürümü: Metro web paketinde bunu, telefonda `KarekodOkut.native.tsx`i çözer. expo-camera
// burada (dolaylı dahil) içe ALINMAZ — web kodu açılışta blob işçisi kurar, bulut CSP'si (`worker-src 'self'`) reddeder;
// `scripts/web-paket-bekcisi.mjs` export çıktısında ölçer. Web'de düğme yok; yine de açılırsa elle girişe yönlendirir.
import { AuthShell } from "./AuthShell";
import { Banner, Button } from "../kit";
import { KAREKOD_YALNIZ_TELEFON, type KarekodOkutProps } from "./karekod-ileti";

export { KAREKOD_ILETI, KAMERA_IZNI_YOK } from "./karekod-ileti";

export function KarekodOkut({ onElle }: KarekodOkutProps) {
  return (
    <AuthShell title="Karekod okut" subtitle="Bu cihazda kamera ile okutma yok">
      <Banner tone="warn" text={KAREKOD_YALNIZ_TELEFON} testID="karekod-yalniz-telefon" />
      <Button label="Adresi elle yaz" tone="plain" icon="create-outline" onPress={() => onElle()} testID="karekod-elle" />
    </AuthShell>
  );
}
