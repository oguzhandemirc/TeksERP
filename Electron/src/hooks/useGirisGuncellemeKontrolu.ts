import { useEffect, useRef } from "react";
import { useUpdater } from "@/hooks/useUpdater";

/**
 * Her girişte güncelleme kontrolü (kullanıcı isteği).
 *
 * Main process zaten açılıştan 30 sn sonra ve 15 dakikada bir kontrol ediyor
 * (`@shared/update-schedule` — TEK zamanlayıcı); bu hook o ritme ÜÇÜNCÜ bir
 * tetik ekler: **oturum açıldığı an**. Kendi zamanlayıcısı YOKTUR, mount başına
 * tek çağrıdır. Sebep, sahadaki
 * gerçek kullanım biçimi — panel günlerce açık kalıyor ve vardiya değişiminde
 * kullanıcı değişiyor. Uygulama açılışına bağlı bir kontrol, haftada bir açılan
 * bir makinede haftada bir koşar; girişe bağlı olan her vardiyada koşar.
 *
 * ⚠️ Mount başına TEK kez tetiklenir. `AppShell` yalnız giriş yapıldığında
 * mount olduğu için "her giriş" karşılığı budur; çıkış → yeniden giriş yeni bir
 * mount, yani yeni bir kontrol.
 *
 * Kontrolün kendisi zaten güvenli: main process aynı anda ikinci bir kontrole
 * izin vermiyor (`checking` kilidi) ve indirilmiş paket varken hiç sormuyor.
 */
export function useGirisGuncellemeKontrolu(): void {
  const { check } = useUpdater();
  const tetiklendi = useRef(false);

  useEffect(() => {
    if (tetiklendi.current) return;
    tetiklendi.current = true;
    void check();
  }, [check]);
}
