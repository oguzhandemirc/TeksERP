// TOTP kurulum karekodu: `otpauth://` bağlantısı doğrulama uygulamasına kamerayla okutulur. Sır yalnız bu
// ekranda, bellekte çizilir (depoya/günlüğe yazılmaz); elle girilecek anahtar karekodun yanında KALIR.
import QRCode from "react-native-qrcode-svg";
import { View } from "react-native";
import { useTokens } from "./theme-context";
import { radius, space } from "./tokens";

export function TotpQr({ value, size = 200 }: { value: string; size?: number }) {
  const t = useTokens();
  if (!value.startsWith("otpauth://")) return null;
  // Karekod her temada beyaz zeminde kalır (koyu zeminde okutulamaz).
  return (
    <View testID="totp-karekod" accessibilityLabel="Doğrulama uygulaması karekodu" style={{ alignSelf: "center", padding: space.m, backgroundColor: t.paper, borderRadius: radius.cardInner, borderWidth: 1, borderColor: t.separator, marginVertical: space.m }}>
      <QRCode value={value} size={size} ecl="M" />
    </View>
  );
}
