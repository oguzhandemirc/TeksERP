// Siparişler sekmesinin kendi yığını: liste → yeni sipariş, sekme çubuğu altta kalır.
import { Stack } from "expo-router";
import { useTokens } from "../../../../src/ui/theme-context";

export default function OrdersStack() {
  const t = useTokens();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}
