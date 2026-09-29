// Ekran odaklanınca `ozet` zili (S47): içerik taşımaz, yalnız fabrikaya "anlık tur" dürtmesi. Hata sessizdir —
// tazeleme en iyi çabadır, ekranın verisi zaten önbellekten/son eşitlemeden gelir.
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { openRefreshGate } from "../lib/refresh";
import { useSession } from "./session";

export function useOpenRefresh(): void {
  const { api } = useSession();
  useFocusEffect(
    useCallback(() => {
      void openRefreshGate.request(Date.now(), () => api.refresh());
    }, [api]),
  );
}
