// Siparişler sekmesinin kendi yığını: liste → yeni sipariş, sekme çubuğu altta kalır.
import { Stack } from "expo-router";
import { useWide } from "../../../../src/ui/Frame";
import { useTokens } from "../../../../src/ui/theme-context";

export default function OrdersStack() {
  const t = useTokens();
  const wide = useWide();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: wide ? "none" : "default" }} />;
}
