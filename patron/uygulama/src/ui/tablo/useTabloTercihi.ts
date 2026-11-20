// Görünüm tercihi kancası (D7): bulut tercih ucunu taşıyorsa (`ListCapability.prefsOnServer`) hesabın tercihi
// sunucuda (`/oturum/tercihler/:anahtar`, telefon değişince de kalır), değilse (ERP kipi, eski bulut) cihazda.
// Yazım iyimser: ekran anında değişir, sunucuya 600 ms birleştirilerek gider; hata sessizdir (tercih iş verisi değil).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewPrefKey } from "../../api/wire";
import { useSession } from "../../state/session";
import { useListCapability } from "../siparis/capabilities";
import { normalizeTercih, VARSAYILAN_TERCIH, type TabloSutunu, type TabloTercihi } from "./model";

export const TERCIH_YAZIM_GECIKMESI_MS = 600;
const yerelAnahtar = (k: ViewPrefKey) => `patron.${k}`;

function yerelDepo(): { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> } | null {
  try {
    return (require("../../state/store") as typeof import("../../state/store")).plainStore;
  } catch {
    return null;
  }
}

export interface TabloTercihiDurumu {
  readonly tercih: TabloTercihi;
  /** Sunucunun bu listede sıralayabildiği alanlar; boşsa sıralama seçimi gizlenir. */
  readonly siralanabilir: readonly string[];
  degistir(next: TabloTercihi): void;
}

export function useTabloTercihi<R>(anahtar: ViewPrefKey, projeksiyon: string, sutunlar: readonly TabloSutunu<R>[]): TabloTercihiDurumu {
  const { api } = useSession();
  const cap = useListCapability();
  const sunucuda = cap.prefsOnServer;
  const siralanabilirHam = cap.sortFields(projeksiyon);
  const siralanabilirAnahtar = siralanabilirHam.join(",");
  const siralanabilir = useMemo(() => (siralanabilirAnahtar ? siralanabilirAnahtar.split(",") : []), [siralanabilirAnahtar]);
  const sutunRef = useRef(sutunlar as readonly TabloSutunu<never>[]);
  sutunRef.current = sutunlar as readonly TabloSutunu<never>[];
  const [tercih, setTercih] = useState<TabloTercihi>(VARSAYILAN_TERCIH);
  const dokunuldu = useRef(false);
  const zamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    dokunuldu.current = false;
    const uygula = (raw: unknown) => {
      if (alive && !dokunuldu.current) setTercih(normalizeTercih(raw, sutunRef.current, siralanabilir));
    };
    if (sunucuda) {
      api.viewPrefGet(anahtar).then((r) => uygula(r.deger), () => undefined);
    } else {
      yerelDepo()
        ?.get(yerelAnahtar(anahtar))
        .then((v) => uygula(v ? (JSON.parse(v) as unknown) : null))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [api, anahtar, sunucuda, siralanabilir]);

  useEffect(() => () => {
    if (zamanlayici.current) clearTimeout(zamanlayici.current);
  }, []);

  const degistir = useCallback(
    (next: TabloTercihi) => {
      dokunuldu.current = true;
      setTercih(next);
      const deger = { sirala: next.sirala, yon: next.yon, gizli: [...next.gizli] };
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
      zamanlayici.current = setTimeout(() => {
        zamanlayici.current = null;
        if (sunucuda) api.viewPrefSet(anahtar, deger).catch(() => undefined);
        else yerelDepo()?.set(yerelAnahtar(anahtar), JSON.stringify(deger)).catch(() => undefined);
      }, TERCIH_YAZIM_GECIKMESI_MS);
    },
    [api, anahtar, sunucuda],
  );

  return { tercih: normalizeTercih(tercih, sutunlar as readonly TabloSutunu<never>[], siralanabilir), siralanabilir, degistir };
}
