import { useQuery } from '@tanstack/react-query';
import { kursunBypassService } from '../services/kursunBypass.service';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from './usePermission';

// =============================================================================
// "Kurşun Dağıtım" karosunun KOŞULLU görünürlüğü için CANLI sayaç.
//
// Karo eskiden yalnız `production.kursunBypassEnabled` bayrağına bakıyordu ve
// bayrak kapatıldığında TAMAMEN kayboluyordu. Route bilinçli olarak açık
// bırakılmıştı (dağıtılmış işler bitirilebilsin) ama mobilde ekran gizlendiği
// için saha personeli dağıtılmış işi ne iptal ne de tamamlayabiliyordu — komut
// paleti/adres çubuğu gibi bir kaçış yolu da yok.
//
// Yeni kural (kullanıcı kararı, 2026-08-02):
//   görünür ⇔ `flagEnabled || pendingAssignmentCount > 0`
// Yani ekran "işi kaldıysa durur, bitince kendiliğinden kaybolur".
// =============================================================================

/**
 * ÖN EK BİLİNÇLİ: `KursunDagitimScreen` her mutasyondan sonra
 * `invalidateQueries({ queryKey: ['kursun-bypass'] })` çağırıyor → bu sorgu da
 * tazelenir ve son iş bitirilince karo kendiliğinden kaybolur. Anahtarı
 * değiştirirsen o davranış sessizce kopar.
 */
export const KURSUN_VISIBILITY_KEY = ['kursun-bypass', 'visibility'] as const;

/**
 * Menü sayacı sorgusu. İki bilinçli karar:
 *
 * • **Yalnız ekranı görebilecek kullanıcı sorar.** Uç izin-kapılıdır
 *   (`mobile:kursun-dagitim` / `workorder:distribute` / `quality:*`); izinsiz her
 *   kullanıcıda çağırmak her açılışta bir 403 üretirdi ve cevabın onlar için bir
 *   anlamı da yok (ekran zaten izin süzgecinde eleniyor).
 *
 * • **Cache DİSKE YAZILMAZ** (`offline/persistPolicy.ts` beyaz listesine bilerek
 *   EKLENMEDİ). Bu canlı bir üretim sayacıdır; app restart'ında "dünkü" değere
 *   bakıp karo göstermek hayalet veridir. Sayaç bilinmiyorken davranış saf
 *   bayrak davranışına düşer (fail-closed) — offline'da zaten dağıtım
 *   iptal/tamamlama mutasyonları da atılamaz (ekran online-only).
 */
export function useKursunBypassVisibility() {
  const hasToken = useAuthStore((s) => !!s.token);
  const { has } = usePermissions();
  return useQuery({
    queryKey: KURSUN_VISIBILITY_KEY,
    queryFn: kursunBypassService.getVisibility,
    // Karo titremesin ama planlamacı Electron'dan dağıtınca da makul sürede
    // belirsin. Anlık tazeleme mutasyon invalidate'inden ve App.tsx'in
    // foreground invalidate'inden gelir.
    staleTime: 60 * 1000,
    enabled: hasToken && has('mobile:kursun-dagitim'),
  });
}

/**
 * Açık (bekleyen) dağıtım sayısı. Yükleme / hata / yetkisiz durumlarda **0** →
 * görünürlük saf bayrak davranışına döner (fail-closed). "Bilmiyorum"u "iş var"
 * saymak, hiç dağıtım yokken herkese boş bir ekran açardı.
 */
export function usePendingKursunAssignmentCount(): number {
  return useKursunBypassVisibility().data?.data?.pendingAssignmentCount ?? 0;
}
