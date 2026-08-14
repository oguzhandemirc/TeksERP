// =============================================================================
// KALEM FİYATI — ERİŞİM BAĞLAMININ TEK KURULUM NOKTASI
// =============================================================================
// NEDEN VAR: rejim + izin kararını üç tüketici verecek (bu paketin sayfası,
// ürün kartına gömülecek "Fiyatlar" bölümü ve ileride komut paleti). Bağlamı
// her yerde elle kurmak, `ItemPriceAccess`'e yeni bir alan eklendiğinde birinin
// sessizce eski/eksik değerle karar vermesi demekti (emsal:
// `useOperationsVisibilityContext`).
//
// Karar burada VERİLMEZ — yalnız DERLENİR; yüklem saf katmandadır (`regime.ts`).
// Dönüş tipi açık yazılır: bağlama alan eklenip burası güncellenmezse derleme
// düşer, alan sessizce `undefined` gelip yüklemi yanlış karara sürükleyemez.
// =============================================================================
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemPricesEditable, itemPricesVisible, type ItemPriceAccess } from "./regime";

export interface ItemPricesAccessState extends ItemPriceAccess {
  visible: boolean;
  editable: boolean;
  /** Bayrak henüz okunmadı — ekran "kapalı" demeden önce beklemeli. */
  isLoading: boolean;
}

export function useItemPricesAccess(): ItemPricesAccessState {
  const flags = useFeatureFlags();
  const { hasPermission } = useRoleAccess();

  // ⚠️ Yüklenmemiş bayrak `false`'a düşer (FAIL-CLOSED): kapalı bir kurulumda
  // ekranı bir an için açmak, açık bir kurulumda bir an geç açmaktan kötüdür.
  // `isLoading` ayrıca dönüyor ki ekran "modül kapalı" cümlesini erken basmasın.
  const access: ItemPriceAccess = {
    financeEnabled: flags.data?.data?.financeEnabled ?? false,
    canRead: hasPermission("item:read"),
    canWrite: hasPermission("price:write"),
  };

  return {
    ...access,
    visible: itemPricesVisible(access),
    editable: itemPricesEditable(access),
    isLoading: flags.isLoading,
  };
}
