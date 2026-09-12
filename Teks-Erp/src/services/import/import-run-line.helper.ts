// =============================================================================
// İÇE AKTARIM SATIR DEFTERİ — yük kurucu (yazmayan katman)
// =============================================================================
// `ImportRunLine` bir koşumun YAZDIĞI her kaydı tutar; geri sarmanın TEK kaynağı
// budur. Burada yalnız YÜK KURULUR (saf fonksiyon), yazımı motor yapar — kural
// böylece DB'ye dokunmadan bekçiyle ölçülebilir.
// Sözleşme: `docs/design/IMPORT-EXPORT-TASARIM.md` §8.
//
// NE SAKLANIR: yalnız DOKUNULAN alanlar. Tam satır fotoğrafı SAKLANMAZ — import'un
// dokunmadığı bir alanı geri yazmak, aradaki meşru değişikliği ezer.
//
// `importRunId` BU YÜKTE YOK: satırlar koşum satırının `upsert`i içinde iç içe
// `createMany` ile yazılır, FK'yi Prisma ebeveynden türetir (ayrı yazımda "koşum
// var ama defteri yok" durumu doğabilirdi).
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { PreparedRow } from "./import.types";

/** `ImportRunLine.action` — şemadaki enum'un TS aynası. */
export type ImportLineActionValue = "CREATE" | "UPDATE" | "REVIVE";

/**
 * REPLACE edilen çocuk koleksiyonlarının sütun anahtarları. Motorun diff'i
 * `changes[k].from`'a yazımdan ÖNCEKİ kümeyi koyduğu için (bkz. `childSnapshotOf`)
 * bu liste yalnız "hangi anahtar çocuk koleksiyonudur" sorusunu cevaplar.
 */
const CHILD_KEYS = [
  "__children", // gruplu adaptör (route): adım ağacının tamamı
  "allowedColorCodes", // item izin listesi
  "allowedPropertyCodes", // item izin listesi
  "stationCodes", // fabricProperty istasyon linkleri
  "valueCodes", // fabricProperty değer listesi
  "propertyCodes", // productRecipe özellikleri
  "categoryCodes", // subcontractor kategorileri
] as const;

/**
 * Defter satırının yükü. Json kolonları OPSİYONEL: `null` geçmek Prisma'da
 * `DbNull`/`JsonNull` ayrımını açar, anahtarı hiç koymamak kolonu NULL bırakır.
 */
export interface ImportRunLinePayload {
  entity: string;
  tableName: string;
  recordId: string;
  rowNo: number;
  keyValue: string | null;
  label: string | null;
  action: ImportLineActionValue;
  rowNos?: Prisma.InputJsonValue;
  changedFields?: Prisma.InputJsonValue;
  childSnapshot?: Prisma.InputJsonValue;
}

/**
 * Yazılan bir satırın defter yükünü kurar.
 *
 * `action`: motorun kararı esastır; **`REVIVE`** yalnız GÖZLENEBİLİR durumda
 * yazılır — güncelleme `isActive`ı `false → true` çevirdiyse.
 * ⚠️ Servisin CREATE yolunda pasif kaydı dirilttiği dar bir dikiş daha var
 * (`decideCodeUniqueness` → `REACTIVATE`), ama motor onu GÖRMÜYOR: `findExisting`
 * pasif kaydı da döndürdüğü için o satır normalde UPDATE'e düşer; dikiş ancak
 * `findExisting` ile kod adaylarının aranması ayrıştığında açılır. Uydurma tespit
 * yazmıyoruz — o dal bugün `CREATE` kaydedilir, kapatılması servisin "dirilttim"
 * bilgisini döndürmesini gerektirir.
 */
export function buildImportRunLine(args: {
  entity: string;
  tableName: string;
  recordId: string;
  row: PreparedRow;
  engineAction: "CREATE" | "UPDATE";
}): ImportRunLinePayload {
  const { entity, tableName, recordId, row, engineAction } = args;
  const changes = row.result.changes ?? {};
  const out: ImportRunLinePayload = {
    entity,
    tableName,
    recordId,
    rowNo: row.input.rowNo,
    keyValue: row.result.key ?? null,
    label: row.result.label ?? null,
    action: engineAction === "UPDATE" && isReactivation(changes) ? "REVIVE" : engineAction,
  };
  // Json alanları: motorun ürettiği düz veri yapıları Prisma'nın özyinelemeli
  // `InputJsonValue` birleşimine birebir oturmaz, dönüşüm yerel ve açık tutulur.
  if (row.result.rowNos && row.result.rowNos.length > 0) out.rowNos = row.result.rowNos;
  // ÇOCUK ANAHTARLARI `changedFields`ten ÇIKARILIR: aynı gerçek iki kolonda
  // durursa tek-kaynak kuralı kırılır (§8.3). Bölüşüm net — skaler alanlar
  // `changedFields`te, REPLACE edilen koleksiyonlar `childSnapshot`ta.
  const scalars: Record<string, { from: unknown; to: unknown }> = {};
  const snap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    // ÇOCUKTA DA `{from,to}` ÇİFTİ saklanır: `from` geri yazılacak küme, `to`
    // import'un YAZDIĞI küme. `to` olmadan "bu koleksiyonu sonradan başkası
    // değiştirdi mi" sorusu sorulamaz ve geri sarma kör üzerine yazardı
    // (skaler alanların atomik claim'inin çocuktaki karşılığı).
    if ((CHILD_KEYS as readonly string[]).includes(k)) snap[k] = { from: v.from ?? null, to: v.to ?? null };
    else scalars[k] = v;
  }
  if (Object.keys(scalars).length > 0) out.changedFields = asJson(scalars);
  if (Object.keys(snap).length > 0) out.childSnapshot = asJson(snap);
  return out;
}

function asJson(v: Record<string, unknown>): Prisma.InputJsonValue {
  return v as unknown as Prisma.InputJsonValue;
}

/** Güncelleme pasif kaydı diriltti mi — tek gözlenebilir REVIVE işareti. */
function isReactivation(changes: Record<string, { from: unknown; to: unknown }>): boolean {
  const c = changes.isActive;
  return c !== undefined && c.from === false && c.to === true;
}

/**
 * REPLACE edilen çocukların YOK EDİLEN hâli — `changedFields`in ÇOCUK İZDÜŞÜMÜ.
 * Kaynak bilerek `existing` değil `changes[k].from`: motorun diff'i zaten
 * `found[k]`i oraya koyuyor, iki ayrı okuma iki ayrı gerçek doğurur. Geri sarma
 * çocukları TEK yerden okur, skaler alanları `changedFields`ten.
 */
function childSnapshotOf(
  changes: Record<string, { from: unknown; to: unknown }>,
): Record<string, unknown> | null {
  const snap: Record<string, unknown> = {};
  for (const key of CHILD_KEYS) {
    const c = changes[key];
    if (c === undefined) continue; // replace edilmediyse fotoğraf gereksiz
    snap[key] = c.from ?? null;
  }
  return Object.keys(snap).length > 0 ? snap : null;
}
