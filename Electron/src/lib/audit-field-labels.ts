// =============================================================================
// AUDIT ALAN ETİKETLERİ — backend haritasının İSTEMCİ AYNASI (Faz C)
// =============================================================================
// ⚠️ AYNA: kaynak `Teks-Erp/src/constants/audit-field-labels.ts`. Electron
// backend'i import edemez (mobil `permissions.ts` ile aynı durum). Ayna
// eksik kalırsa ekran ham alan adını gösterir — FAIL-OPEN, hiçbir zaman boş
// kalmaz. Bu yüzden ayna bekçisi UYARIR ama kırmızı VERMEZ.
// =============================================================================

const LABELS: Readonly<Record<string, string>> = {
  name: "Ad", code: "Kod", isActive: "Aktif", notes: "Not", description: "Açıklama",
  width: "En", currentQty: "Metraj", initialQty: "Giriş metrajı", weightKg: "Ağırlık (kg)",
  status: "Durum", qualityGrade: "Kalite", qualityGradeId: "Kalite", foldType: "Kat",
  barcode: "Barkod", colorId: "Renk", itemId: "Kumaş", entryReason: "Ekleme nedeni",
  entryReasonCode: "Ekleme nedeni (kod)", cancelReasonCode: "İptal sebebi (kod)",
  workOrderNumber: "İş emri no", targetQuantity: "Hedef metraj", targetWeight: "Hedef ağırlık",
  targetItemId: "Hedef kumaş", targetColorId: "Hedef renk", routeTemplateId: "Rota şablonu",
  plannedStartDate: "Planlanan başlangıç", plannedEndDate: "Planlanan bitiş", type: "Tür",
  cancelReason: "İptal sebebi", orderNumber: "Sipariş no", customerId: "Müşteri",
  branchId: "Şube", quantity: "Miktar", dueDate: "Termin",
  customerItemName: "Müşterideki kumaş adı", customerColorName: "Müşterideki renk adı",
  alias: "Müşterideki ad", shipmentNo: "Sevkiyat no", sackNo: "Çuval no",
  destination: "Hedef", invoiceNo: "Fatura no", procedureCode: "İhracat kodu",
  dispatchNote: "Sevk notu", subcontractorId: "Fason firma", dispatchNo: "Sevk no",
  receiptNo: "Makbuz no", batchNumber: "Parti no", username: "Kullanıcı adı",
  fullName: "Ad soyad", passwordHash: "Parola", pin: "PIN", isDefault: "Varsayılan",
  language: "Yazıcı dili", mode: "Mod", html: "Şablon içeriği",
  snapshot: "Belge içeriği", config: "Ayarlar",
};

/** Alanın Türkçe karşılığı; yoksa HAM AD (fail-open). */
export function auditFieldLabel(field: string): string {
  return LABELS[field] ?? field;
}

/** Değeri okunabilir metne çevirir — null/boş "—", nesne kısaltılır. */
export function auditValueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "object") return "(içerik)";
  const s = String(v);
  // Uzun metin satırı taşırmasın; tam değer title'da gösterilir.
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export const AUDIT_FIELD_LABEL_KEYS = Object.keys(LABELS);
