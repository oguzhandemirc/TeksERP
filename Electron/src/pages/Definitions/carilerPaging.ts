// =============================================================================
// CARİLER — İKİ KAYNAKTAN TEK LİSTE (saf katman)
// =============================================================================
// Bekçi: `carilerPaging.test.ts`.
//
// NEDEN DEĞİŞTİ: ekran iki kaynağı da `loadAllForPicker` ile çekiyordu ve o
// yardımcı toplam > 500 olunca **throw** eder. Sayfa `isError`'ı hiç okumadığı
// için sonuç "Kart bulunamadı." oluyordu — yani 500+ carisi olan alım-satım
// müşterisinde ekran, TÜM cari kartları silinmiş gibi görünüyordu. Üstelik
// ticaret rejiminde Müşteriler/Fason karoları gizli olduğu için başka giriş
// kapısı da yok. Arama da istemci tarafındaydı: sunucuya hiç gitmiyordu.
//
// ⚠️ İKİ KAYNAK, İKİ BAĞIMSIZ SAYFA — ve bu bilinçli. Kartlar iki AYRI tabloda
// yaşıyor (`Customer` + `Subcontractor`); tek bir global alfabetik sayfa ancak
// ikisini de tam çekip birleştirmekle olurdu, yani düzeltilmek istenen 500
// duvarının aynısı. Her kaynak KENDİ sayfasını verir, sayfa içinde birleşip
// ada göre sıralanır. Bunun tek maliyeti sıralamanın SAYFA İÇİ olmasıdır;
// karşılığında hiçbir kart kaybolmaz (her kayıt tam olarak bir sayfada çıkar).
// =============================================================================
import { SUPPLIER_ROLE_LABEL, type SupplierRole } from "@/components/forms/supplierPicker";
import type { CompanyType } from "@/types/enums";

/** Rol süzgecinin DEĞERİ enum anahtarıdır (etiket değil); "" = tüm roller. Etiket haritadan çizilir. */
export type CariRoleFilter = "" | SupplierRole;

const CARI_ROLES: readonly SupplierRole[] = ["CUSTOMER", "SUPPLIER", "BOTH", "SUBCONTRACTOR"];
/** Süzgeç seçenekleri — etiketler `SUPPLIER_ROLE_LABEL`tan (tek kaynak `companyTypeLabels`). */
export const CARI_ROLE_FILTER_OPTIONS: readonly { value: CariRoleFilter; label: string }[] = [
  { value: "", label: "Tüm roller" },
  ...CARI_ROLES.map((value) => ({ value, label: SUPPLIER_ROLE_LABEL[value] })),
];

/**
 * Rol süzgecinden SORGU PLANI.
 *
 * ⚠️ Süzme SUNUCUDA: liste sayfalı, istemcide süzmek yalnız O ANKİ SAYFAYI
 * süzer ve kullanıcı "Fason" seçtiğinde ilk sayfada fason yoksa "kayıt yok"
 * sanır — oysa kayıt bir sonraki sayfadadır (`RollFilterBar` dersi).
 *
 * Fason (SUBCONTRACTOR) seçiliyken müşteri ucu HİÇ çağrılmaz (ve tersi): boş dönecek bir
 * isteği atmak, sayfa başına gereksiz bir yuvarlak yol demektir.
 */
export function cariQueryPlan(role: CariRoleFilter): {
  customers: boolean;
  subcontractors: boolean;
  /** `filter[type]` — yalnız müşteri tarafında anlamlı. */
  companyType?: CompanyType;
  /** Fason = carinin rolü: "Tüm roller"de bağlı fason CARİ satırında (rozet "· Fason") görünür, fason bacağı
   *  yalnız BAĞSIZ fasonları ister (`filter[customerId]=null`); "Fason" süzgecinde fason bacağı hepsini getirir. */
  unlinkedSubcontractorsOnly?: boolean;
} {
  if (role === "SUBCONTRACTOR") return { customers: false, subcontractors: true, unlinkedSubcontractorsOnly: false };
  if (role) return { customers: true, subcontractors: false, companyType: role };
  return { customers: true, subcontractors: true, unlinkedSubcontractorsOnly: true };
}

export interface CariMergeRow {
  kind: "CUSTOMER" | "SUBCONTRACTOR";
  id: string;
  name: string;
}

/**
 * İki kaynağın AYNI sayfasını birleştirip ada göre sıralar.
 *
 * ⚠️ Sıralama `localeCompare(…, "tr")`: "Ç" ile "C", "İ" ile "I" ASCII sırada
 * yanlış yere düşer ve kullanıcı listeyi alfabetik saymaz.
 */
export function mergeCariRows<T extends CariMergeRow>(customers: T[], subs: T[]): T[] {
  return [...customers, ...subs].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/**
 * Sayfa bilgisi — iki kaynağın toplamı.
 *
 * ⚠️ `hasNext` İKİSİNİN "VEYA"sıdır: biri bitip diğeri devam ediyorsa sayfa
 * hâlâ vardır. "VE" yazılsaydı, müşterileri biten kurulumda fason kartlarının
 * kuyruğu sessizce erişilemez olurdu.
 */
export function cariPageInfo(args: {
  page: number;
  pageSize: number;
  customerTotal: number;
  subTotal: number;
  plan: { customers: boolean; subcontractors: boolean };
}): { total: number; hasPrev: boolean; hasNext: boolean } {
  const cTotal = args.plan.customers ? args.customerTotal : 0;
  const sTotal = args.plan.subcontractors ? args.subTotal : 0;
  const consumed = args.page * args.pageSize;
  return {
    total: cTotal + sTotal,
    hasPrev: args.page > 1,
    hasNext: (args.plan.customers && cTotal > consumed) || (args.plan.subcontractors && sTotal > consumed),
  };
}
