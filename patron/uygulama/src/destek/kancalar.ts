// Taleplerim ve talep ayrıntısı kancaları: ilk yükleme · çek-yenile · ekran odaktayken ve uygulama öndeyken ~30 sn'de
// bir sessiz yenileme · sayfa sayfa devam. Hata ekranda gösterilir ama mevcut liste/talep silinmez; 403
// `MODULE_DISABLED` destek girişini gizler (`destekHatasiniIsle`).
import { useCallback, useEffect, useRef, useState } from "react";
import type { DestekKapsam, DestekListeOgesi, DestekSayfa, DestekTalep } from "../api/destek-wire";
import { useAppActive } from "../state/useForeground";
import { useScreenFocus } from "../state/useScreenFocus";
import { EKRAN_YENILEME_MS, destekHatasiniIsle, destekRozetiniTazele, type DestekApi } from "./gorunurluk";

export const SAYFA_BOYU = 30;

/** Sayfa-numaralı liste → sonraki sayfa ya da undefined. */
export function sonrakiSayfa(s: Pick<DestekSayfa, "page" | "limit" | "total" | "items">): number | undefined {
  if (s.items.length === 0) return undefined;
  return s.page * s.limit < s.total ? s.page + 1 : undefined;
}

/** Odakta + önde iken `fn`i aralıkla çağırır. */
export function useOdaktaYenile(fn: () => void, ms: number = EKRAN_YENILEME_MS): void {
  const aktif = useAppActive();
  const [odakta, setOdakta] = useState(true);
  const cb = useRef(fn);
  cb.current = fn;
  useScreenFocus(
    useCallback(() => {
      setOdakta(true);
      return () => setOdakta(false);
    }, []),
  );
  useEffect(() => {
    if (!aktif || !odakta) return;
    const id = setInterval(() => cb.current(), ms);
    return () => clearInterval(id);
  }, [aktif, odakta, ms]);
}

export interface ListeApi {
  supportList(p: { scope: DestekKapsam; page?: number; limit?: number }): Promise<DestekSayfa>;
}

export function useTaleplerim(api: ListeApi, scope: DestekKapsam) {
  const [items, setItems] = useState<readonly DestekListeOgesi[] | null>(null);
  const [sonraki, setSonraki] = useState<number | undefined>(undefined);
  const [hata, setHata] = useState<unknown>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  const surum = useRef(0);

  const yukle = useCallback(async (kullanici: boolean) => {
    const benim = ++surum.current;
    if (kullanici) setYenileniyor(true);
    try {
      const s = await api.supportList({ scope, page: 1, limit: SAYFA_BOYU });
      if (benim !== surum.current) return;
      setItems(s.items);
      setSonraki(sonrakiSayfa(s));
      setHata(null);
    } catch (e) {
      if (benim !== surum.current) return;
      destekHatasiniIsle(e);
      setHata(e);
    } finally {
      if (benim === surum.current) setYenileniyor(false);
    }
  }, [api, scope]);

  const devam = useCallback(async () => {
    if (sonraki === undefined) return;
    const benim = surum.current;
    try {
      const s = await api.supportList({ scope, page: sonraki, limit: SAYFA_BOYU });
      if (benim !== surum.current) return;
      setItems((onceki) => {
        const gorulen = new Set((onceki ?? []).map((x) => x.id));
        return [...(onceki ?? []), ...s.items.filter((x) => !gorulen.has(x.id))];
      });
      setSonraki(sonrakiSayfa(s));
    } catch (e) {
      destekHatasiniIsle(e);
    }
  }, [api, scope, sonraki]);

  useEffect(() => {
    setItems(null);
    setSonraki(undefined);
    setHata(null);
    void yukle(false);
  }, [yukle]);
  useOdaktaYenile(() => void yukle(false));

  return { items, hata, yenileniyor, yenile: () => void yukle(true), devam, sonrakiVar: sonraki !== undefined };
}

export interface AyrintiApi extends DestekApi {
  supportGet(id: string): Promise<DestekTalep>;
  supportRead(id: string): Promise<{ lastReadAt: string }>;
}

/** Ayrıntı: açılışta ve yeni ekip yanıtı geldikçe `okundu` + rozet tazeleme (hatası yutulur). */
export function useTalep(api: AyrintiApi, id: string) {
  const [talep, setTalep] = useState<DestekTalep | null>(null);
  const [hata, setHata] = useState<unknown>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  const okunanMesaj = useRef(-1);

  const okundu = useCallback((t: DestekTalep) => {
    if (t.messages.length === okunanMesaj.current) return;
    okunanMesaj.current = t.messages.length;
    api.supportRead(t.id).then(() => destekRozetiniTazele(api), () => undefined);
  }, [api]);

  const yukle = useCallback(async (kullanici: boolean): Promise<DestekTalep | null> => {
    if (kullanici) setYenileniyor(true);
    try {
      const t = await api.supportGet(id);
      setTalep(t);
      setHata(null);
      okundu(t);
      return t;
    } catch (e) {
      destekHatasiniIsle(e);
      setHata(e);
      return null;
    } finally {
      setYenileniyor(false);
    }
  }, [api, id, okundu]);

  useEffect(() => {
    setTalep(null);
    okunanMesaj.current = -1;
    void yukle(false);
  }, [yukle]);
  useOdaktaYenile(() => void yukle(false));

  /** Gönderim/kapama yanıtındaki güncel talep doğrudan yazılır (yeniden okuma yok). */
  const guncelle = useCallback((t: DestekTalep) => {
    setTalep(t);
    okunanMesaj.current = t.messages.length;
  }, []);

  return { talep, hata, yenileniyor, yenile: () => void yukle(true), yeniden: () => yukle(false), guncelle };
}
