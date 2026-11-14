// Siparişler sekmesinin kendi yığını: liste → yeni sipariş, sekme çubuğu altta kalır.
import { Stack } from "expo-router";
import { FORM_SHEET_OPTIONS, useWide } from "../../../../src/ui/Frame";
import { useTokens } from "../../../../src/ui/theme-context";

/** Geniş ekranda kart olarak açılan sipariş formları (ekran `Screen sheet` verir). */
const FORM_ROUTES = ["yeni", "duzenle", "iptal", "kalem-iptal", "kalemler"] as const;

export default function OrdersStack() {
  const t = useTokens();
  const wide = useWide();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: wide ? "none" : "default" }}>
      {FORM_ROUTES.map((name) => <Stack.Screen key={name} name={name} options={wide ? FORM_SHEET_OPTIONS : {}} />)}
    </Stack>
  );
}
