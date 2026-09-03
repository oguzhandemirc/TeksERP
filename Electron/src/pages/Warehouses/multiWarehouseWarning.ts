// =============================================================================
// İKİNCİ AKTİF DEPO — "modül kapalı" UYARISI (saf katman)
// =============================================================================
// 2026-09-02'ye kadar çok-depoluluk VERİDEN TÜRETİLİYORDU ("aktif depo > 1") ve
// ikinci depoyu açmak yüzeyleri kendiliğinden getiriyordu. Artık açık bir modül
// anahtarı (`depo.multiEnabled`) var — yani ikinci depoyu açan kullanıcı, eskiden
// beklediği şeyi GÖRMEZ: depo seçicileri çizilmez, transfer karosu belirmez ve
// hiçbir yerde sebebi yazmaz. Bu uyarı tam olarak o sessizliği kapatır.
//
// ⚠️ ENGEL DEĞİL BİLGİ: ikinci depo tanımlamak modülden BAĞIMSIZ olarak meşrudur
// (depo kartı ve depo defteri anahtardan bağımsız çalışır). Kaydetmeyi
// reddetmek, kullanıcıyı kapatamayacağı bir kapıya çarptırırdı.
//
// ⚠️ SAYIM KENDİNİ DIŞLAR: düzenlenen depo zaten aktifse onu iki kez saymak
// "ikinci depo açıyorsun" yalanını üretirdi (tek depolu kurulumda depo adını
// düzeltmek uyarı basardı).
// =============================================================================

export interface MultiWarehouseWarningInput {
  /** `depo.multiEnabled` — modül anahtarı (yüklenene kadar `false`). */
  depoMultiEnabled: boolean;
  /** Şu an AKTİF olan depoların id listesi. */
  activeWarehouseIds: string[];
  /** Düzenlenen deponun id'si — yeni kayıtta `null`. */
  editingId: string | null;
  /** Kaydetme sonrası bu depo aktif olacak mı? */
  willBeActive: boolean;
}

/** Uyarı basılsın mı? */
export function shouldWarnMultiWarehouseClosed(input: MultiWarehouseWarningInput): boolean {
  if (input.depoMultiEnabled) return false;
  if (!input.willBeActive) return false;
  const others = input.activeWarehouseIds.filter((id) => id !== input.editingId);
  return others.length >= 1;
}
