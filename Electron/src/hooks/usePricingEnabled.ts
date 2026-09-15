import { useQuery } from "@tanstack/react-query";
import { featureFlagService, DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { isSameTypeSessionPolicy } from "@/lib/session-auth";
import {
  DEFAULT_SHIPMENT_ORDER_REQUIREMENT,
  DEFAULT_SHIPPING_INVOICE_MODE,
  isShipmentOrderRequirement,
  isShippingInvoiceMode,
  type ShipmentOrderRequirement,
  type ShippingInvoiceMode,
  type SackDumpNameMode,
} from "@/lib/shipping-flags";

const QUERY_KEY = ["feature-flags"];

export function useFeatureFlags() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => featureFlagService.get(),
    staleTime: 5 * 60 * 1000,
  });
}

/** ERP'nin kurulduğu firmanın adı. Yüklenene kadar varsayılana düşer. */
export function useCompanyName(): string {
  const q = useFeatureFlags();
  return q.data?.data?.companyName?.trim() || DEFAULT_COMPANY_NAME;
}

/** Etkin mobil giriş yöntemleri (auth.loginMethods.enabled). Yüklenene dek yalnız liste. */
export function useEnabledLoginMethods(): ("list" | "pin" | "card")[] {
  const q = useFeatureFlags();
  const enabled = q.data?.data?.loginMethods?.enabled;
  return Array.isArray(enabled) && enabled.length > 0 ? enabled : ["list"];
}

export function usePricingEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.pricingEnabled ?? false;
}

/**
 * DEMO KURULUMU MU?
 *
 * ⚠️ `?? false` load-bearing: bayrak yüklenene kadar (ve okunamazsa) demo
 * yardımcıları ÇİZİLMEZ. Ters varsayılan, sunucuya ulaşamayan bir panelde
 * fabrikaya demo düğmeleri gösterirdi.
 */
/**
 * Tezgah izleme modülü açık mı (`tezgah.enabled`). Yüklenene dek KAPALI —
 * fail-closed: modülün yüzeyleri (Hazır Sebepler'deki duruş sekmesi) referans
 * profilde hiç belirmemeli, "bir an görünüp kaybolan" sekme de sıfır fark değildir.
 */
export function useTezgahEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.tezgahEnabled ?? false;
}

/**
 * Dokuma modülü açık mı (`dokuma.enabled`, ebeveyni `production.enabled`). Yüklenene
 * dek KAPALI — fail-closed. İstasyon formunda `WEAVING` türü yalnız bununla çizilir
 * ("kapalı modülün bayrağı çizilmez" kuralının istasyon-türü ayağı, 1e 2026-09-14).
 */
export function useDokumaEnabled(): boolean {
  const q = useFeatureFlags();
  const d = q.data?.data;
  return (d?.productionEnabled ?? false) && (d?.dokumaEnabled ?? false);
}

/** Devere modülü açık mı (`devere.enabled`). Yüklenene dek KAPALI — fail-closed. */
export function useDevereEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devereEnabled ?? false;
}

/** G3 Emanet / konsinye mülkiyet modülü açık mı (`emanet.enabled`). Yüklenene dek KAPALI — fail-closed:
 *  sahip müşteri alanı yalnız bununla çizilir; bağımsız modül. */
export function useEmanetEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.emanetEnabled ?? false;
}

/** Devere Faz 2: iplik lotu zorunlu mu (`devere.lotRequired`). Yüklenene dek KAPALI = bugünkü davranış (lot isteğe bağlı). */
export function useDevereLotRequired(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devereLotRequired ?? false;
}

/** Devere Faz 3: levent tezgah bağı defteri açık mı (`devere.mountTracking`). Yüklenene dek KAPALI = bugünkü davranış (levent hazır kalır, yüzey çizilmez). */
export function useDevereMountTracking(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devereMountTracking ?? false;
}

/** Devere Faz 3: bağlamada yöntem + başlangıç saati zorunlu mu (`devere.mountTrackingRequired`). */
export function useDevereMountTrackingRequired(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devereMountTrackingRequired ?? false;
}

export function useDemoModeEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.demoModeEnabled ?? false;
}

export function useTargetQuantityEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.targetQuantityEnabled ?? false;
}

export function useRawWidthEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.rawWidthEnabled ?? false;
}

/** KK1 ham kumaş girişinde ağırlık (kg) alanı açık mı? Default false; backend ENFORCE eder. */
export function useKk1WeightEntryEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.kk1WeightEntryEnabled ?? false;
}

/**
 * FASON KABULÜ — çekme uyarısı (bayrak + tolerans birlikte).
 *
 * Boyahanede kumaş çeker: giden ile dönen metrajın farklı olması normaldir.
 * Uyarı yalnız toleransın ÜSTÜNDE çıkar. Mobil ikizi `useFasonShrinkWarn`
 * (mobil bu projeyi import edemez — iki yüzeyin aynı kuralı uygulaması için
 * eşiğin TEK kaynağı sunucudur).
 */
export function useFasonShrinkWarn(): { enabled: boolean; tolerancePct: number } {
  const q = useFeatureFlags();
  return {
    enabled: q.data?.data?.fasonShrinkWarnEnabled ?? true,
    tolerancePct: q.data?.data?.fasonShrinkTolerancePct ?? 10,
  };
}

export function useReturnGradingEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.returnGradingEnabled ?? false;
}

export function useKartelaMeasurementEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.kartelaMeasurementEnabled ?? false;
}

export function usePartyCodeAuto(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.partyCodeAuto ?? false;
}

export function useFasonNoteMobileEntry(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.fasonNoteMobileEntry ?? false;
}

export function useDevicePairingRequired(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devicePairingRequired ?? false;
}

export function useShipmentConfirmationEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shipmentConfirmationEnabled ?? false;
}

/**
 * `shipping.manualSackCountEnabled` — "araca yüklenen gerçek çuval adedi" alanı.
 * Kapalıyken alan hiç çizilmez; backend yazmayı da reddeder.
 */
export function useShipmentManualSackCountEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shipmentManualSackCountEnabled ?? false;
}

/**
 * `shipping.weighRequiredEnabled` — sevk öncesi TÜM çuvallar tartılı olsun mu.
 *
 * ⚠️ FAIL-OPEN (yüklenene kadar `false`): bayrak henüz gelmediği için sahayı
 * "sevk edemez" hâle getirmek yanlış yön — otorite zaten SUNUCUDADIR ve tartısız
 * sevki o reddeder. İstemcinin işi uyarıyı ÖNCEDEN göstermek, kapı olmak değil.
 */
export function useShippingWeighRequiredEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shippingWeighRequiredEnabled ?? false;
}

/**
 * `shipping.manualWeightRestrictedEnabled` — elle kg girişi yetkiyle sınırlı mı.
 *
 * ⚠️ FAIL-OPEN: istemci yalnız menü satırını gizler; reddi sunucu verir. Kapalı
 * yönde varsaymak, bayrak yüklenemediğinde yetkili kullanıcıdan da kaçış yolunu
 * (kantarsız/arızalı durum) alırdı.
 */
export function useShippingManualWeightRestrictedEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shippingManualWeightRestrictedEnabled ?? false;
}

/** `shipping.orderRequirement` — sevkiyat siparişe bağlansın mı. Varsayılan `warn`. */
export function useShippingOrderRequirement(): ShipmentOrderRequirement {
  const q = useFeatureFlags();
  const v = q.data?.data?.shippingOrderRequirement;
  return isShipmentOrderRequirement(v) ? v : DEFAULT_SHIPMENT_ORDER_REQUIREMENT;
}

/** `shipping.invoiceMode` — fatura izi rejimi. Varsayılan `dis` (bugünkü). */
export function useShippingInvoiceMode(): ShippingInvoiceMode {
  const q = useFeatureFlags();
  const v = q.data?.data?.shippingInvoiceMode;
  return isShippingInvoiceMode(v) ? v : DEFAULT_SHIPPING_INVOICE_MODE;
}

/** Kurşun bypass düzeni açık mı. Yüklenene kadar false (default kapalı).
 *  Yalnız YENİ dağıtımı kapılar — dağıtılmış iş emirleri bayrak kapansa da biter. */
export function useKursunBypassEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.kursunBypassEnabled ?? false;
}

/**
 * Paketleme grubu (çalışma yaftası) açık mı. Yüklenene kadar FALSE.
 *
 * ⚠️ Fail yönü KAPALI ve bu bilinçli: bayrak yüklenemediğinde ekran bugünkü düz
 * listeye düşer. Ters yön tehlikeli olurdu — grup şeridi çizilip sunucu bayrağı
 * kapalı bilseydi "Parti Ata" 403 verir, operatör sebebini göremezdi.
 */
export function usePackingGroupsEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.packingGroupsEnabled ?? false;
}

/** Çuval/grup içerik dökümünde ad rejimi VARSAYILANI (pencere tek seferlik ezebilir). */
export function useSackDumpNameMode(): SackDumpNameMode {
  const q = useFeatureFlags();
  const v = q.data?.data?.sackDumpNameMode;
  return v === "bizdeki" || v === "musterideki" || v === "ikisi" ? v : "ikisi";
}

/** Müşteri şubeleri (sevk noktaları) açık mı. Yüklenene kadar true (default açık). */
export function useCustomerBranchesEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.customerBranchesEnabled ?? true;
}

/** Oturum (JWT) ömrü, DAKİKA. Yeni key yoksa saat*60'a düşer, o da yoksa 480 (8 saat). */
export function useSessionDurationMinutes(): number {
  const q = useFeatureFlags();
  const f = q.data?.data;
  if (f?.sessionDurationMinutes != null) return f.sessionDurationMinutes;
  if (f?.sessionDurationHours != null) return f.sessionDurationHours * 60;
  return 480;
}

/** Oturum (JWT) ömrü, saat. Yüklenene kadar 8 (backend varsayılanı). Geriye uyum. */
export function useSessionDurationHours(): number {
  const q = useFeatureFlags();
  return q.data?.data?.sessionDurationHours ?? 8;
}

/** Hareketsizlik zaman aşımı, dakika. Yüklenene kadar 0 (kapalı). */
export function useIdleTimeoutMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.idleTimeoutMinutes ?? 0;
}

/** Çalışma oturumu (saha) idle zaman aşımı, dakika. Yüklenene kadar 20 (yeni default). */
export function useWorkSessionIdleTimeoutMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.workSessionIdleTimeoutMinutes ?? 20;
}

/** Token süresi dolunca otomatik çıkış açık mı. Yüklenene kadar true (default açık). */
export function useAutoLogoutOnExpiry(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.autoLogoutOnExpiry ?? true;
}

/** Mobil hareketsizlik kilidi açık mı. Yüklenene kadar true (default açık). */
export function useMobileIdleLockEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.mobileIdleLockEnabled ?? true;
}

/** Mobil hareketsizlik kilidi süresi, dakika. Yüklenene kadar 10 (default). */
export function useMobileIdleLockMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.mobileIdleLockMinutes ?? 10;
}

/** Mutlak oturum tavanı, gün. Yüklenene kadar 30 (default). 0 = süresiz. */
export function useAbsoluteSessionCapDays(): number {
  const q = useFeatureFlags();
  return q.data?.data?.absoluteSessionCapDays ?? 30;
}

/** Hızlı PIN/kart deneme kilidi açık mı. Yüklenene kadar true (default açık). */
export function usePinLockoutEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutEnabled ?? true;
}

/** Hızlı PIN/kart deneme kilidi: izin verilen yanlış deneme. Yüklenene kadar 5. */
export function usePinLockoutAttempts(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutAttempts ?? 5;
}

/** Hızlı PIN/kart deneme kilidi: kısa ceza süresi (sn). Yüklenene kadar 60. */
export function usePinLockoutPenaltySec(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutPenaltySec ?? 60;
}

/** Hızlı PIN/kart deneme kilidi: uzun cezaya geçiş eşiği (tur). Yüklenene kadar 3. */
export function usePinLockoutEscalateAfter(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutEscalateAfter ?? 3;
}

/** Hızlı PIN/kart deneme kilidi: uzun ceza süresi (dk). Yüklenene kadar 15. */
export function usePinLockoutLongPenaltyMin(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutLongPenaltyMin ?? 15;
}

/** Aynı tip oturum politikası. Yüklenene/geçersiz değerde kadar 'kick' (default). */
export function useSameTypeSessionPolicy(): SameTypeSessionPolicy {
  const q = useFeatureFlags();
  const v = q.data?.data?.sameTypeSessionPolicy;
  return isSameTypeSessionPolicy(v) ? v : "kick";
}

/** Otomatik gece yedeğinin saati (sunucu yerel saati). Yüklenene kadar 3 (default). */
export function useBackupHour(): number {
  const q = useFeatureFlags();
  return q.data?.data?.backupHour ?? 3;
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
