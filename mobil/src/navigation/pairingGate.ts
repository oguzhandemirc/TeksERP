// =============================================================================
// Cihaz onay kapısı — TEK KARAR NOKTASI (2026-09-04)
// =============================================================================
// Saha bulgusu: `devicePairingRequired` KAPALI olmasına rağmen tablet "Cihaz
// Atama Bekliyor" ekranında kalıyordu. Kök sebep sunucudaydı (yeni cihaz bayrağa
// bakılmadan PENDING doğuyordu) ama sınıfı istemciyi de ilgilendiriyor: karar iki
// ayrı uçtan (`/devices/pairing-required` + `/devices/status`) toplanıp istemcide
// kuruluyordu, yani her istemci onu ayrı ayrı yanlış kurabilirdi.
//
// Artık karar SUNUCUDA: `/devices/status` ve `/devices/announce` cevapları
// `pairingRequired` taşır. Bu yüklem yalnız onu okur; ayrı uçtan gelen bayrak
// SADECE cevap henüz yokken (ilk açılış / eski backend) taban olarak kullanılır.
// =============================================================================

import type { DeviceAssignment } from '../services/device.service';

export interface PairingGateInput {
  /**
   * `GET /devices/pairing-required` cevabı. Login ÖNCESİ bilinen tek kaynak ve
   * atama poll'unu de o açar; hata halinde istemci false varsayar (fail-open —
   * operatör en azından Login'e ulaşır).
   */
  flagFromEndpoint: boolean;
  /** `/devices/status` (ya da `/devices/announce`) cevabı; henüz yoksa undefined. */
  assignment?: Pick<DeviceAssignment, 'status' | 'pairingRequired'> | null;
}

/**
 * Onay ekranı (`AwaitingAssignmentScreen`) gösterilsin mi?
 *
 * ⚠️ `??` LOAD-BEARING: sunucunun taşıdığı karar HER ZAMAN kazanır, ayrı uçtan
 * gelen (ve 5 dk cache'lenen) bayrak yalnız o alan YOKKEN devreye girer. `||`
 * yazılsaydı sunucunun "artık gerekmiyor" cevabı bayat bir `true` tarafından
 * yutulur ve tablet kapıda kalırdı; `&&` yazılsaydı tersi olurdu.
 *
 * ⚠️ Alanı taşımayan ESKİ backend'de davranış birebir eskisi gibi kalır
 * (`undefined ?? flagFromEndpoint`) — deploy sırası backend ÖNCE, ama tabletler
 * günlerce eski paketle koşabilir.
 */
export function shouldShowPairingGate(input: PairingGateInput): boolean {
  const required = input.assignment?.pairingRequired ?? input.flagFromEndpoint;
  // Cevap henüz gelmediyse (assignment yok) kapı AÇIK sayılır — bayrak gerçekten
  // zorunluysa onaysız cihazı bir an için Login'e düşürmek, backend'in TÜM
  // isteklerini 401 DEVICE_INACTIVE ile kestiği bir ekran demektir.
  return required && input.assignment?.status !== 'APPROVED';
}
