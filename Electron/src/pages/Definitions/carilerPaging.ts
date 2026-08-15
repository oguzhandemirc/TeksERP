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

export type CariRoleFilter = "" | "Müşteri" | "Tedarikçi" | "Alıcı + Satıcı" | "Fason";

/** Rol etiketi → `Customer.type` kodu (backend süzgeci). */
const ROLE_TO_COMPANY_TYPE: Record<string, string> = {
  Müşteri: "CUSTOMER",
  Tedarikçi: "SUPPLIER",
  "Alıcı + Satıcı": "BOTH",
};

/**
 * Rol süzgecinden SORGU PLANI.
 *
 * ⚠️ Süzme SUNUCUDA: liste sayfalı, istemcide süzmek yalnız O ANKİ SAYFAYI
 * süzer ve kullanıcı "Fason" seçtiğinde ilk sayfada fason yoksa "kayıt yok"
 * sanır — oysa kayıt bir sonraki sayfadadır (`RollFilterBar` dersi).
 *
 * "Fason" seçiliyken müşteri ucu HİÇ çağrılmaz (ve tersi): boş dönecek bir
 * isteği atmak, sayfa başına gereksiz bir yuvarlak yol demektir.
 */
export function cariQueryPlan(role: CariRoleFilter): {
  customers: boolean;
  subcontractors: boolean;
  /** `filter[type]` — yalnız müşteri tarafında anlamlı. */
  companyType?: string;
} {
  if (role === "Fason") return { customers: false, subcontractors: true };
  const type = ROLE_TO_COMPANY_TYPE[role];
  if (type) return { customers: true, subcontractors: false, companyType: type };
  return { customers: true, subcontractors: true };
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
