// TOTP kurulum karekodu: `otpauth://` bağlantısı doğrulama uygulamasına kamerayla okutulur. Sır yalnız bu
// ekranda, bellekte çizilir (depoya/günlüğe yazılmaz); elle girilecek anahtar karekodun yanında KALIR.
import QRCode from "react-native-qrcode-svg";
import { View } from "react-native";
import { color, space } from "./theme";

export function TotpQr({ value, size = 200 }: { value: string; size?: number }) {
  if (!value.startsWith("otpauth://")) return null;
  return (
    <View testID="totp-karekod" accessibilityLabel="Doğrulama uygulaması karekodu" style={{ alignSelf: "center", padding: space.m, backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: color.line, marginVertical: space.m }}>
      <QRCode value={value} size={size} ecl="M" />
    </View>
  );
}
