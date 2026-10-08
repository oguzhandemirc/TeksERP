import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveApiBaseUrl, onApiBaseUrlApplied } from "@/lib/api-config";

export type Reachability = "checking" | "reachable" | "unreachable";

/**
 * Aktif sunucu adresi cevap veriyor mu — GİRİŞ DENEMESİNDEN ÖNCE.
 *
 * NEDEN: eskiden bunu ancak kullanıcı adını/şifresini yazıp "Giriş Yap"a
 * bastıktan sonra öğreniyorduk ve hata "Sunucuya ulaşılamıyor" diye tek satırlık
 * bir toast'tı. Yeni kurulan bir bilgisayarda bu, kullanıcıyı yanlış yere
 * bakmaya iter.
 *
 * ⚠️ `window.api.discovery` YOKSA (tarayıcı derlemesi, birim testi) **"reachable"
 * kabul edilir**. Aksi halde IPC köprüsü olmayan her ortam giriş formunu
 * gizlerdi — testler dahil. Fail-open burada doğru yön: yanlış pozitif bir
 * "sunucu yok" ekranı, çalışan bir kurulumu kullanılamaz gösterir.
 *
 * Adres değişince (Sunucu Adresi penceresinde kayıt dahil) kendiliğinden yeniden ölçer; yalnız EN SON
 * yoklamanın sonucu yazılır — eski adresin geç gelen "null"ı yeni adresin sonucunu ezmez.
 */
export function useServerReachability() {
  const [status, setStatus] = useState<Reachability>("checking");
  const seq = useRef(0);

  const recheck = useCallback(async () => {
    const api = window.api?.discovery;
    const mine = ++seq.current;
    if (!api) {
      setStatus("reachable");
      return;
    }
    setStatus("checking");
    let next: Reachability;
    try {
      const res = await api.probe(getActiveApiBaseUrl());
      next = res ? "reachable" : "unreachable";
    } catch {
      // Köprü hatası sunucunun yokluğu DEĞİLDİR — formu gizleme.
      next = "reachable";
    }
    if (mine === seq.current) setStatus(next);
  }, []);

  useEffect(() => {
    void recheck();
    return onApiBaseUrlApplied(() => void recheck());
  }, [recheck]);

  return { status, recheck };
}
