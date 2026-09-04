import { useEffect, useState } from "react";
import apiClient from "@/services/apiClient";

export interface ClientVersionPolicy {
  /** Bu backend'in çalışabildiği en düşük panel sürümü. */
  minVersion: string;
  /** Yayındaki güncel sürüm (bilgi amaçlı — kilit değil). */
  currentVersion: string;
  /** Kilit devreye girdiğinde gösterilecek ek cümle. */
  message?: string;
}

/**
 * Backend'in "hangi panel sürümünü beklediğini" okur
 * (`GET /api/client-policy/electron`, public uç).
 *
 * Neden gerekli: bu projede deploy sırası **backend ÖNCE**. Yeni bir API
 * sözleşmesi çıktığında sahada bir süre eski paneller çalışır ve bazı
 * sözleşme değişiklikleri onlarda GÖRÜNÜR bir hata üretmez — alan sessizce
 * düşer. Politika, o sessiz aralığı kapatır.
 *
 * ⚠️ **FAIL-OPEN.** Uç okunamazsa, yanıt bozuksa ya da sunucu eskiyse (uç henüz
 * yok → 404) `null` döner ve panel KİLİTLENMEZ. Bu, projenin genel fail-closed
 * eğiliminin bilinçli istisnasıdır: buradaki "kapalı" taraf, tek bir bozuk
 * yanıt yüzünden fabrikadaki TÜM panellerin çalışmaz hale gelmesi demektir.
 *
 * Yoklama aralığı 4 saat ve güncelleyicinin ritminden BAĞIMSIZDIR (o 2026-09-04'te
 * 15 dk'ya indi): politika bir backend deploy'uyla değişir, sık yoklamanın
 * kazandıracağı bir şey yok. İki eksen ayrı — biri yayın kanalını, öteki
 * sunucu sözleşmesini izler.
 */
const POLICY_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function useClientPolicy(): ClientVersionPolicy | null {
  const [policy, setPolicy] = useState<ClientVersionPolicy | null>(null);

  useEffect(() => {
    let active = true;

    const oku = async () => {
      try {
        const r = await apiClient.get("/api/client-policy/electron");
        const d = r?.data?.data as ClientVersionPolicy | undefined;
        // Alan yoksa politika YOK sayılır — yarım bir yanıtla kilitlemeyiz.
        if (active && d && typeof d.minVersion === "string" && d.minVersion) {
          setPolicy(d);
        }
      } catch {
        // Sessiz: sunucuya ulaşılamaması ayrı bir yüzeyin işi (bağlantı
        // göstergesi). Burada gürültü yapmak, offline makinede her 4 saatte bir
        // anlamsız bir uyarı üretirdi.
      }
    };

    void oku();
    const t = setInterval(() => void oku(), POLICY_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return policy;
}
