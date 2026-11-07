// Çuvallar — süzgeç tanımları + tek satır kayıt sözleşmesi (2026-11-07 panel filtre dalga 5'te sayfadan ayrıldı).
import type { FilterDef } from "@/components/data-table/FilterBar";
import { persistConfigOf, splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { customerService } from "@/pages/Customers/service";
import { branchLookupService } from "@/pages/Operations/Shipments/service";
import type { BranchLookupItem } from "@/pages/Operations/Shipments/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { sackTagService } from "@/pages/SackTags/service";
import { SCAN_SEED_KEYS } from "./SackEntryGate";
import { CUSTOMERLESS_FILTER_VALUE, UNTAGGED_FILTER_VALUE, scopeLabels, type SackSearchScope } from "./types";

// Filtreler URL-driven (FilterBar → useSearchParams → useDataTable cursor reset).
// Kapsam omit edilirse backend POOL+PLANNED (sevk edilmemiş) döner — sağlıklı varsayılan.
export const SACK_FILTERS_TUM: FilterDef[] = [
  {
    kind: "select",
    key: "scope",
    label: "Kapsam",
    // Etiketler `scopeLabels`'tan (TEK KAYNAK) — elle kopyalanmıyor. Buradaki eski
    // kopya "Planlı/Kapıda" diyordu; KAPI ÖNÜ ARA ADIMI KALDIRILDI (PLANNED →
    // DISPATCHED, kök CLAUDE.md) → operatöre artık var olmayan bir aşama gösteriyordu.
    // String kopyalamak aynı bayatlamayı tekrar doğurur.
    options: (Object.keys(scopeLabels) as SackSearchScope[]).map((v) => ({
      value: v,
      label: scopeLabels[v],
    })),
  },
  // Çoklu seçim (VEYA): backend virgülle ayrılmış ID'leri IN'e çevirir (searchSacks).
  {
    kind: "multi-lookup",
    key: "customerId",
    label: "Müşteri",
    service: customerService,
    queryKey: "customers",
    // ⚠️ "Müşterisiz (genel stok)" KATALOGDA YOKTUR — `Sack.customerId` opsiyonel
    // olduğu için gerçek ve büyük bir kümedir (ölçüm 2026-09-04: depodaki 9
    // çuvalın 4'ü). Sentinel eklenene kadar bu küme hiçbir yüzeyden
    // SÜZÜLEMİYORDU; giriş kapısındaki "Müşterisiz" satırı da buraya düşer.
    sentinelOption: { value: CUSTOMERLESS_FILTER_VALUE, label: "Müşterisiz (genel stok)" },
  },
  {
    // ŞUBE — cariye BAĞLI (Siparişler/Sevkiyatlar ile aynı `dependent-lookup`
    // kalıbı; yeni kalıp icat edilmedi). Liste "Şube" kolonunu zaten basıyordu,
    // süzgeci yoktu.
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerCsv) => {
      // ⚠️ "Müşterisiz" SENTİNELİ AYIKLANIR: `customerId` bu ekranda katalogda
      // karşılığı olmayan bir değer (`none`) taşıyabilir (giriş kapısındaki
      // "Müşterisiz (genel stok)" satırı). Ham gönderilse `/api/customer-branches`
      // onu UUID sanar → P2007 → lookup 500. Sentinelden başka bir şey kalmazsa
      // sorgu HİÇ yapılmaz (müşterisiz çuvalın şubesi de olamaz).
      const ids = customerCsv
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v && v !== CUSTOMERLESS_FILTER_VALUE);
      if (ids.length === 0) return Promise.resolve([]);
      return loadAllForPicker(branchLookupService, {
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true", customerId: ids.join(",") },
      }).then((r) => r.data);
    },
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  // KALİTE (2026-08-13 saha isteği: "hangi çuvalda 2. kalite var?"). Semantik
  // İÇEREN'dir: seçilen kaliteden EN AZ BİR top taşıyan çuvallar gelir — karışık
  // çuval meşru ve zaten aranan da "içine karışmış mı" sorusu.
  // Katalogdan okunur (sabit liste YOK): fabrika kalite ekler/adlandırırsa
  // filtre kendiliğinden doğru kalır.
  {
    kind: "multi-lookup",
    key: "qualityGrade",
    label: "Kalite",
    service: qualityGradeService,
    queryKey: "quality-grades",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  {
    // TARTI — "hangi çuvallar hâlâ tartılmadı?" (ölçüm 2026-09-04, tekserp_demo:
    // 33 çuvalın 32'si tartısız). Liste "Kg" kolonunu basıyor ama süzemiyordu;
    // `shipping.weighRequiredEnabled` açık kurulumda bu liste yapılacak işin kendisi.
    kind: "select",
    key: "weighed",
    label: "Tartı",
    options: [
      { value: "true", label: "Tartıldı" },
      { value: "false", label: "Tartılmadı" },
    ],
  },
  {
    // İÇERİK — yalnız "boş mu" sorulabilir (ilişki sayımına göre aralık süzmesi
    // Prisma'da tek sorguda ifade edilemez); soru gerçek: boş çuval silinir.
    // ⚠️ "Boş" sunucuda HAYALET TOPU dışlayan yüklemle çözülür (PRESENT_ROLL_WHERE)
    // — listedeki "Top: 0" ile bu filtre aynı kümeyi göstermek zorunda.
    kind: "select",
    key: "empty",
    label: "İçerik",
    options: [
      { value: "false", label: "Dolu" },
      { value: "true", label: "Boş" },
    ],
  },
  {
    // ÇUVAL İZİ (2026-09-04) — "kontrol edilecek çuvallar hangileri?".
    // ⚠️ ÇOKLU SEÇİM SEMANTİĞİ **VEYA**: seçilen izlerden EN AZ BİRİNİ taşıyan
    // çuvallar gelir (alan içi OR standardı). Ekranda AÇIKÇA yazılı olması
    // gerekiyor — "ikisi de olanlar" sanan operatör listeyi yanlış okur; etiket
    // metni bu yüzden "Etiket" değil "İz (VEYA)".
    // ⚠️ "İzsiz" katalogda KARŞILIĞI OLMAYAN bir kümedir → `sentinelOption`
    // (müşterisiz kovasının birebir emsali); sunucu sentineli UUID listesinden
    // AYIRIR (`splitTagFilter`), ham geçseydi `@db.Uuid` kolonda P2007 → 400.
    kind: "multi-lookup",
    key: "tagId",
    label: "İz (VEYA)",
    service: sackTagService,
    queryKey: "sack-tags",
    sentinelOption: { value: UNTAGGED_FILTER_VALUE, label: "İzsiz (etiketi olmayan)" },
  },
  {
    // NOT — liste "Not" kolonunu basıyor; "notu olanları göster" tarama sorusu.
    kind: "select",
    key: "hasNote",
    label: "Not",
    options: [
      { value: "true", label: "Notu olanlar" },
      { value: "false", label: "Notu olmayanlar" },
    ],
  },
  {
    // TARİH — `createdAt` sıralanabilir kolonun süzgeç ikizi. "Tartı" alanı
    // seçilirse tartılmamış çuvallar (weighedAt NULL) tanım gereği düşer.
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Oluşturma" },
      { value: "weighedAt", label: "Tartı" },
    ],
  },
];


/**
 * ŞUBE KAPALIYSA ŞUBE SÜZGECİ ÇİZİLMEZ (2026-09-07).
 *
 * `customer.branchesEnabled` kapalı bir kurulumda şube diye bir kavram YOKTUR;
 * süzgeç ve kolon yine de duruyordu ve hep "—" basıyordu. Emsal `CreateShipmentDialog`
 * — orada zaten `useCustomerBranchesEnabled()` sorulur; bu ekran sormuyordu.
 */
/**
 * Süzgeç kümesi bağlama göre: şube yalnız bayrak açıkken; CARİ süzgeci parti modunda
 * cari çalışma alanındayken (cari → parti → çuvallar) ÇİZİLMEZ — cari zaten
 * başlıkta, başka cariye geçiş geri okuyla (saha 2026-09-22). URL'deki
 * `filter[customerId]` korunur; şube süzgeci ondan beslenmeye devam eder.
 */
export function sackFiltreleri(branchesEnabled: boolean, customerHidden: boolean): FilterDef[] {
  const hidden = new Set<string>([...(branchesEnabled ? [] : ["branchId"]), ...(customerHidden ? ["customerId"] : [])]);
  return SACK_FILTERS_TUM.filter((f) => !("key" in f && hidden.has(f.key)));
}


/**
 * Kayıt allowlist'i: Müşteri ve Şube HARİÇ bütün tanımlar. Cariyi giriş kapısı ve parti çalışma
 * alanı URL'ye yazar (gezinme durumu); kaydedilseydi kapıyı atlatır, parti modunu kendiliğinden açardı.
 */
export const SACK_PERSIST = persistConfigOf(SACK_FILTERS_TUM.filter((f) => !("key" in f && (f.key === "customerId" || f.key === "branchId"))));
/** Satırda: Kapsam · Müşteri · Kumaş · Renk; tarih ve gerisi "+ Filtre"de. */
export const SACK_PRIMARY = ["scope", "customerId", "itemId", "colorId"];

/** Tek satır bölmesi: tarih birincil DEĞİL (çuvalda tarih ikincil soru; satır dar ekranda taşmasın). */
export function sackRowSplit(branchesEnabled: boolean, customerHidden: boolean) {
  return splitDefFilters(sackFiltreleri(branchesEnabled, customerHidden), SACK_PRIMARY, { datePrimary: false });
}

/** Okutma tohumu ya da parti içi açılış = hedefli (derin bağlantı). Tohum URL'yi ilk effect'te yazar; bu yüzden bağlam açılışta okunur. */
export function isTargetedOpen(state: unknown, sp: URLSearchParams): boolean {
  const st = state as Record<string, unknown> | null;
  return SCAN_SEED_KEYS.some((k) => typeof st?.[k] === "string") || sp.has("filter[packingGroupId]");
}
