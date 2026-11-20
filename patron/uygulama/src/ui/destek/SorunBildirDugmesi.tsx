// "Sorun bildir" — her ekranın başlığında küçük simge (yalnız destek AÇIKKEN; `Screen` karar verir). Dokununca ÖNCE o
// anki ekranın görüntüsü alınır (form açılmadan), sonra talep formu açılır. Yakalama düşerse (web, eski derleme, hata)
// talep yine açılır, yalnız görüntüsüz.
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { Pressable } from "react-native";
import { ekranAdiBul } from "../../destek/baglam";
import { yeniTaslak } from "../../destek/taslak";
import { ekraniYakala } from "../../destek/yakala";
import { useTokens } from "../theme-context";

export const SORUN_BILDIR_ETIKETI = "Sorun bildir";

/** Yakala → taslak → form. Çift dokunuş ikinci yakalama başlatmaz. */
export function useSorunBildir(yakala: typeof ekraniYakala = ekraniYakala): () => Promise<void> {
  const router = useRouter();
  const path = usePathname();
  const mesgul = useRef(false);
  return useCallback(async () => {
    if (mesgul.current) return;
    mesgul.current = true;
    try {
      const ekran = await yakala();
      yeniTaslak({ ekran, ekranAdi: ekranAdiBul(path), yol: path });
      router.push("/destek/yeni" as never);
    } finally {
      mesgul.current = false;
    }
  }, [path, router, yakala]);
}

export function SorunBildirDugmesi() {
  const t = useTokens();
  const bildir = useSorunBildir();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={SORUN_BILDIR_ETIKETI}
      accessibilityHint="Bu ekranın görüntüsüyle destek talebi açar"
      testID="sorun-bildir"
      hitSlop={8}
      onPress={() => void bildir()}
      style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name="help-buoy-outline" size={22} color={t.textMuted} />
    </Pressable>
  );
}
