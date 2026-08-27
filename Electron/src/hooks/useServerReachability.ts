import { useCallback, useEffect, useState } from "react";
import { getActiveApiBaseUrl } from "@/lib/api-config";

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
 */
export function useServerReachability() {
  const [status, setStatus] = useState<Reachability>("checking");

  const recheck = useCallback(async () => {
    const api = window.api?.discovery;
    if (!api) {
      setStatus("reachable");
      return;
    }
    setStatus("checking");
    try {
      const res = await api.probe(getActiveApiBaseUrl());
      setStatus(res ? "reachable" : "unreachable");
    } catch {
      // Köprü hatası sunucunun yokluğu DEĞİLDİR — formu gizleme.
      setStatus("reachable");
    }
  }, []);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  return { status, recheck };
}
