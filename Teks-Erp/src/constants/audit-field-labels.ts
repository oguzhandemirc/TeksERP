// =============================================================================
// AUDIT ALAN ETİKETLERİ — "width" değil "En" (Faz B2, 2026-08-19)
// =============================================================================
// Kullanıcı kararı (şıklarla soruldu): Türkçe etiket + ham ada FAIL-OPEN.
// Etiketi olmayan alan HAM ADIYLA basılır; ekran boş kalmaz, harita eksikliği
// hiçbir zaman baskıyı/görüntülemeyi düşürmez.
//
// ⚠️ FAIL-OPEN'IN TEST KARŞILIĞI DA FAIL-OPEN'DIR: bekçi eksik etiketi UYARIR
// ama KIRMIZI VERMEZ. Aksi halde şemaya eklenen her yeni kolon testi kırardı ve
// ekip "kırmızı bekçiyi görmezden gelmeyi" öğrenirdi.
//
// ⚠️ Burası ARAYÜZ sözlüğüdür, veri sözleşmesi değil: etiket değiştirmek
// geçmiş audit kayıtlarını etkilemez (kayıtta ham alan adı durur).
// =============================================================================

export const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  // ── Ortak ──
  name: "Ad",
  code: "Kod",
  isActive: "Aktif",
  notes: "Not",
  description: "Açıklama",

  // ── Top / üretim ──
  width: "En",
  currentQty: "Metraj",
  initialQty: "Giriş metrajı",
  weightKg: "Ağırlık (kg)",
  status: "Durum",
  qualityGrade: "Kalite",
  qualityGradeId: "Kalite",
  foldType: "Kat",
  barcode: "Barkod",
  colorId: "Renk",
  itemId: "Kumaş",
  entryReason: "Ekleme nedeni",
  entryReasonCode: "Ekleme nedeni (kod)",
  cancelReasonCode: "İptal sebebi (kod)",

  // ── İş emri ──
  workOrderNumber: "İş emri no",
  targetQuantity: "Hedef metraj",
  targetWeight: "Hedef ağırlık",
  targetItemId: "Hedef kumaş",
  targetColorId: "Hedef renk",
  routeTemplateId: "Rota şablonu",
  plannedStartDate: "Planlanan başlangıç",
  plannedEndDate: "Planlanan bitiş",
  type: "Tür",
  cancelReason: "İptal sebebi",

  // ── Sipariş ──
  orderNumber: "Sipariş no",
  customerId: "Müşteri",
  branchId: "Şube",
  quantity: "Miktar",
  dueDate: "Termin",
  customerItemName: "Müşterideki kumaş adı",
  customerColorName: "Müşterideki renk adı",
  alias: "Müşterideki ad",

  // ── Sevkiyat / çuval ──
  shipmentNo: "Sevkiyat no",
  sackNo: "Çuval no",
  destination: "Hedef",
  invoiceNo: "Fatura no",
  procedureCode: "İhracat kodu",
  dispatchNote: "Sevk notu",

  // ── Fason ──
  subcontractorId: "Fason firma",
  dispatchNo: "Sevk no",
  receiptNo: "Makbuz no",
  batchNumber: "Parti no",

  // ── Kullanıcı / yetki ──
  username: "Kullanıcı adı",
  fullName: "Ad soyad",
  passwordHash: "Parola",
  pin: "PIN",

  // ── Etiket / belge ──
  isDefault: "Varsayılan",
  language: "Yazıcı dili",
  mode: "Mod",
  html: "Şablon içeriği",
  snapshot: "Belge içeriği",
  config: "Ayarlar",

  // ── Değeri ADA ÇÖZÜLEN alanlar (audit-value-resolver ile eşleşir) ──────────
  // Bu ikisi birlikte çalışır: harita UUID'yi ada çevirir, buradaki etiket alan
  // adını Türkçeleştirir. Biri eksikse satır yarı okunur kalır
  // ("workOrderId: İE1908260014") — bekçi ikisinin örtüşmesini denetler.
  plannedColorId: "Planlanan renk",
  customerBranchId: "Şube",
  stationId: "İstasyon",
  currentStationId: "Bulunduğu istasyon",
  entryStationId: "Giriş istasyonu",
  machineId: "Makine",
  createdMachineId: "Oluşturan makine",
  routeId: "Rota",
  propertyId: "Özellik",
  fabricPropertyId: "Özellik",
  valueId: "Özellik değeri",
  defectTypeId: "Hata tipi",
  returnReasonId: "İade sebebi",
  orderId: "Sipariş",
  workOrderId: "İş emri",
  batchId: "Parti",
  rollId: "Top",
  parentRollId: "Kaynak top",
  sackId: "Çuval",
  shipmentId: "Sevkiyat",
  userId: "Kullanıcı",
  operatorId: "Operatör",
  assignedToId: "Atanan kişi",
  printedById: "Basan kişi",
};

/**
 * Alan adının insan-okur karşılığı. Etiket yoksa HAM AD döner (fail-open).
 *
 * Boş/`undefined` alan adı da güvenle geçer: arayüz hiçbir koşulda boş satır
 * göstermez, en kötü ihtimalle teknik adı gösterir.
 */
export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}
