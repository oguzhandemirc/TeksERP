// ERP telefon push: oturum hazırken SESSİZ kayıt tazelemesi (izin İSTEMEZ — yalnız önceden verilmişse belirteci
// fabrikaya yeniden yazar) + cihaz belirteci değişince yeniden kayıt. Çevrimdışıyken yazma yok; hatalar yutulur.
import { useEffect } from "react";
import { useSession } from "../state/session";
import { secretStore } from "../state/store";
import { erpPushAcik, erpPushEtkinlestir, yerelPortlar, type PushPortlari } from "./erp-push";

export function useErpPushKaydi(enabled: boolean, portlar: () => PushPortlari = yerelPortlar, nativePush?: boolean): void {
  const { yetenek, server, pushCihazci, offline } = useSession();
  const acik = enabled && !offline && server !== null && pushCihazci !== null && erpPushAcik(yetenek.patronPush, nativePush);
  useEffect(() => {
    if (!acik || server === null || pushCihazci === null) return;
    const b = { acik: true, adres: server, cihazci: pushCihazci, store: secretStore, portlar };
    const run = () => void erpPushEtkinlestir(b, { iste: false }).catch(() => undefined);
    run();
    return portlar().belirtecDegisince(run);
  }, [acik, server, pushCihazci, portlar]);
}
