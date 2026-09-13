// =============================================================================
// TOPLU İÇE AKTARIM — MOTOR (önizle → uygula)
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md §3b
//
// ⚠️ EN ÖNEMLİ SÖZLEŞME — "önizlemeye GÜVENİLMEZ":
// `apply` istemcinin gönderdiği önizleme sonucunu kullanmaz; AYNI doğrulamayı
// sıfırdan koşar. Arada dünya değişmiş olabilir (başka biri aynı kodu yaratmış,
// bir renk pasife alınmış). Sevkiyat `cancel-preview` → `cancel` deseninin
// birebir aynısı.
//
// ⚠️ ATOMİKLİK — dürüst sözleşme (D2 "ya hep ya hiç"in uygulanabilir hâli):
// Yazma, mevcut SERVİSLER üzerinden yapılır (D4 — guard'lar korunsun). O
// servisler global `prisma` ile çalışır ve tek bir `$transaction` içine
// alınamaz (adapter-pg'de tx ayrı bağlantıdadır → yazımlar tx'in DIŞINA kaçar
// ve rollback onları geri almaz; sahte bir "atomik" vaadi, gerçek kısmi
// yazımdan KÖTÜDÜR).
// Bu yüzden atomiklik ŞÖYLE kurulur:
//   1) TÜM satırlar önce doğrulanır. Tek hata varsa (onError=abort) HİÇBİR ŞEY
//      yazılmaz — pratikte başarısızlıkların tamamına yakını burada yakalanır
//      (bozuk veri, eksik referans, mükerrer kod).
//   2) Yazma sırasında beklenmedik bir hata çıkarsa (yarış, DB) İLK HATADA
//      DURULUR ve sonuç `PARTIAL` + `stoppedAtRowNo` ile bildirilir. Kısmi
//      sonuç asla SESSİZ kalmaz; `ImportRun` satırı da kalıcı iz bırakır.
// Bu ayrım kullanıcıya da aynen yazılır (panel sonuç kartı + şablon açıklaması).

import { Prisma } from "@prisma/client";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { getImportAdapter, listAdapters } from "./import-registry";
import { applyNameGuard, checkDuplicateNamesInFile } from "./import-name-guard";
import { buildImportRunLine } from "./import-run-line.helper";
import type { ImportRunLinePayload } from "./import-run-line.helper";
import {
  assertRowLimit,
  isClearLiteral,
  parseBool,
  parseDateCell,
  parseLocaleNumber,
} from "./import-coerce";
import type {
  ImportAdapter,
  ImportApplyResult,
  ImportColumn,
  ImportContext,
  ImportOptions,
  ImportPreviewResult,
  ImportRowInput,
  ImportRowResult,
  PreparedRow,
} from "./import.types";
import { upperTr } from "../../utils/tr-case";

function emptyContext(userId?: string): ImportContext {
  return { userId, cache: new Map() };
}

/** Hücre metnini sütun tipine göre dönüştürür; hata mesajı Türkçe. */
function coerceCell(
  col: ImportColumn,
  raw: string,
): { value?: unknown; error?: string } {
  const text = raw.trim();
  if (isClearLiteral(text)) return { value: null };

  switch (col.type) {
    case "text":
    case "lookup": {
      if (col.maxLen && text.length > col.maxLen) {
        return { error: `${col.label}: en fazla ${col.maxLen} karakter (gönderilen ${text.length}).` };
      }
      return { value: text };
    }
    case "number":
    case "int": {
      const n = parseLocaleNumber(text);
      if (n === null) return { error: `${col.label}: sayı okunamadı ('${text}').` };
      if (col.type === "int" && !Number.isInteger(n)) {
        return { error: `${col.label}: tam sayı olmalı ('${text}').` };
      }
      if (n < 0) return { error: `${col.label}: negatif olamaz ('${text}').` };
      return { value: n };
    }
    case "bool": {
      const b = parseBool(text);
      if (b === null) {
        return { error: `${col.label}: Evet/Hayır yazın ('${text}' anlaşılmadı).` };
      }
      return { value: b };
    }
    case "date": {
      const d = parseDateCell(text);
      if (!d) return { error: `${col.label}: tarih okunamadı ('${text}') — GG.AA.YYYY yazın.` };
      return { value: d };
    }
    case "enum": {
      const wanted = upperTr(text);
      const match = col.enumValues?.find(
        (e) =>
          upperTr(e.value) === wanted ||
          upperTr(e.label) === wanted,
      );
      if (!match) {
        const list = (col.enumValues ?? []).map((e) => e.label).join(" · ");
        return { error: `${col.label}: '${text}' geçerli değil. Kabul edilenler: ${list}` };
      }
      return { value: match.value };
    }
    default:
      return { error: `${col.label}: bilinmeyen sütun tipi.` };
  }
}

/** Değerleri karşılaştırılabilir hâle getirir (diff için). */
function comparable(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return [...v].map(String).sort().join("|");
  if (typeof v === "object") {
    // Prisma Decimal ve benzerleri
    const s = String(v);
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v;
  return String(v);
}

/**
 * Satırları dönüştürür + kararlarını verir. HİÇBİR ŞEY YAZMAZ.
 * `preview` ve `apply` ikisi de bunu çağırır — tek doğrulama noktası.
 */
async function prepareRows(
  adapter: ImportAdapter,
  rows: ImportRowInput[],
  options: ImportOptions,
  ctx: ImportContext,
): Promise<{ prepared: PreparedRow[]; unknownColumns: string[] }> {
  const colByKey = new Map(adapter.columns.map((c) => [c.key, c]));
  const unknown = new Set<string>();
  const mode = options.mode ?? "upsert";

  // --- 1. hücre dönüşümü ----------------------------------------------------
  const prepared: PreparedRow[] = rows.map((input) => {
    const values: Record<string, unknown> = {};
    const result: ImportRowResult = { rowNo: input.rowNo, action: "SKIP", errors: [], warnings: [] };

    for (const [key, rawValue] of Object.entries(input.cells ?? {})) {
      const col = colByKey.get(key);
      if (!col) {
        unknown.add(key);
        continue;
      }
      if (typeof rawValue !== "string") continue;
      // BOŞ HÜCRE = "dokunma" (D3). Payload'a hiç girmez.
      if (rawValue.trim() === "") continue;
      const out = coerceCell(col, rawValue);
      if (out.error) result.errors.push({ column: key, message: out.error });
      else values[key] = out.value;
    }
    return { input, values, result };
  });

  // --- 2. anahtar + (gruplama | dosya-içi mükerrer) ------------------------
  const keyCol = adapter.keyColumns[0];
  if (!keyCol) throw new Error(`${adapter.entity}: keyColumns boş`);
  for (const p of prepared) {
    const rawKey = p.values[keyCol];
    p.result.key = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : null;
  }

  let units: PreparedRow[];
  if (adapter.grouped) {
    // GRUPLU ADAPTÖR: aynı anahtarı taşıyan satırlar TEK kayıttır (rota + adımları).
    // Başlık sütunları grubun İLK satırından okunur; `child` sütunları her
    // satırdan bir çocuk üretir. Mükerrer anahtar burada HATA DEĞİL, tasarımdır.
    const childCols = adapter.columns.filter((c) => c.child).map((c) => c.key);
    const byKey = new Map<string, PreparedRow>();
    units = [];
    for (const p of prepared) {
      const key = p.result.key;
      if (!key) {
        // Anahtarsız satır hangi kayda ait olduğunu söylemiyor. "Bir üsttekine
        // ait" varsayımı sessiz veri karışmasıdır — açık hata veriyoruz.
        p.result.errors.push({
          column: keyCol,
          message: "Bu satırda anahtar boş — gruplu şablonda HER satır ait olduğu kaydın anahtarını taşımalı.",
        });
        units.push(p);
        continue;
      }
      const norm = upperTr(key);
      const childValues: Record<string, unknown> = {};
      for (const c of childCols) if (p.values[c] !== undefined) childValues[c] = p.values[c];

      const head = byKey.get(norm);
      if (!head) {
        p.children = [{ rowNo: p.input.rowNo, values: childValues }];
        p.result.rowNos = [p.input.rowNo];
        // Başlık kaydında çocuk sütunlar durmasın (diff'i kirletir).
        for (const c of childCols) delete p.values[c];
        byKey.set(norm, p);
        units.push(p);
      } else {
        head.children!.push({ rowNo: p.input.rowNo, values: childValues });
        head.result.rowNos!.push(p.input.rowNo);
        // Devam satırındaki BAŞLIK sütunları sessizce yok sayılmaz: farklıysa
        // kullanıcı iki farklı şey yazmıştır ve hangisinin kazandığını görmeli.
        for (const [k, v] of Object.entries(p.values)) {
          if (childCols.includes(k) || k === keyCol) continue;
          if (head.values[k] !== undefined && String(head.values[k]) !== String(v)) {
            head.result.warnings.push({
              column: k,
              message: `${p.input.rowNo}. satırdaki farklı değer yok sayıldı — başlık bilgileri grubun İLK satırından okunur.`,
            });
          }
        }
      }
    }
  } else {
    const seen = new Map<string, number>();
    for (const p of prepared) {
      const key = p.result.key;
      if (!key) continue;
      const norm = upperTr(key);
      const firstRow = seen.get(norm);
      if (firstRow !== undefined) {
        p.result.errors.push({
          column: keyCol,
          message: `Bu anahtar dosyada ${firstRow}. satırda da var — aynı kayıt iki kez işlenemez.`,
        });
      } else {
        seen.set(norm, p.input.rowNo);
      }
    }
    units = prepared;
  }

  // --- 3. mevcut kayıtları TOPLU getir -------------------------------------
  const keys = [...new Set(units.map((p) => p.result.key).filter((k): k is string => Boolean(k)))];
  const existing = keys.length > 0 ? await adapter.findExisting(keys) : new Map();

  // --- 4. karar + diff ------------------------------------------------------
  for (const p of units) {
    const key = p.result.key;
    const found = key ? (existing.get(upperTr(key)) ?? existing.get(key) ?? null) : null;
    p.existing = found;
    p.result.targetId = (found?.id as string | undefined) ?? null;

    if (found) {
      if (mode === "createOnly") {
        p.result.errors.push({
          column: keyCol,
          message: `'${key}' zaten var — 'Yalnız yeni ekle' modunda güncelleme yapılmaz.`,
        });
      }
      // createOnly hataları da dahil, diff'i hesapla ki kullanıcı NE değişeceğini görsün.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(p.values)) {
        const col = colByKey.get(k);
        if (!col || col.readOnly) continue;
        if (col.createOnly) {
          // Anahtar sütunun kendisi hariç: anahtar zaten eşleşme için gerekli.
          if (k !== keyCol && comparable(v) !== comparable(found[k])) {
            p.result.errors.push({
              column: k,
              message: `${col.label} mevcut kayıtta değiştirilemez (yalnız yeni kayıtta yazılır).`,
            });
          }
          continue;
        }
        if (comparable(v) !== comparable(found[k])) {
          changes[k] = { from: found[k] ?? null, to: v };
        }
      }
      p.result.changes = changes;
      p.result.label = (found.name as string | undefined) ?? key ?? null;
      // GRUPLU adaptörde çocuk listesi (adımlar) de karşılaştırılır: başlık aynı
      // ama adımlar değiştiyse satır SKIP'e düşmemeli. Adaptör mevcut çocukları
      // `__children` anahtarıyla sunar; sunmuyorsa çocuk varlığı değişiklik sayılır.
      if (adapter.grouped && p.children) {
        // ⚠️ İki taraf AYNI ŞEKİLDE kanonikleştirilir (sütun sırası + boş=null).
        // Ham `JSON.stringify` karşılaştırması, kullanıcının doldurmadığı her
        // sütun yüzünden HER satırı "değişti" gösterir → hiç değişmemiş rotalar
        // her yüklemede yeniden yazılır (audit gürültüsü + `updatedAt` kayması,
        // ki envanter listeleri ona göre sıralanıyor).
        const childKeys = adapter.columns.filter((c) => c.child).map((c) => c.key);
        const canon = (vals: Record<string, unknown>): string =>
          childKeys.map((k) => String(comparable(vals[k] ?? null))).join("\u0001");
        const nextChildren = p.children.map((c) => canon(c.values)).join("\u0002");
        const prevList = (found.__children as Array<Record<string, unknown>> | undefined) ?? [];
        const prevChildren = prevList.map(canon).join("\u0002");
        if (prevChildren !== nextChildren) {
          changes.__children = { from: prevList, to: p.children.map((c) => c.values) };
        }
      }
      p.result.action = Object.keys(changes).length === 0 ? "SKIP" : "UPDATE";
    } else {
      if (mode === "updateOnly") {
        p.result.errors.push({
          column: keyCol,
          message: key
            ? `'${key}' bulunamadı — 'Yalnız güncelle' modunda yeni kayıt oluşturulmaz.`
            : "Anahtar boş — 'Yalnız güncelle' modunda eşleşecek kayıt yok.",
        });
      }
      p.result.label = (p.values.name as string | undefined) ?? key ?? null;
      p.result.action = "CREATE";

      // Zorunlu alanlar YALNIZ yeni kayıtta aranır (güncellemede boş = dokunma).
      for (const col of adapter.columns) {
        if (!col.required || col.readOnly || col.child) continue;
        const v = p.values[col.key];
        if (v === undefined || v === null || v === "") {
          p.result.errors.push({ column: col.key, message: `${col.label} zorunlu (yeni kayıt).` });
        }
      }
    }

    // ÇOCUK satırların zorunlu alanları HER satırda aranır (yeni/mevcut fark
    // etmez): çocuk listesi replace edildiği için eksik bir adım, adımın
    // silinmesi değil BOZUK yazılması demektir.
    if (adapter.grouped && p.children) {
      for (const col of adapter.columns) {
        if (!col.required || !col.child) continue;
        for (const child of p.children) {
          const v = child.values[col.key];
          if (v === undefined || v === null || v === "") {
            p.result.errors.push({
              column: col.key,
              message: `${col.label} zorunlu — ${child.rowNo}. satırda boş.`,
            });
          }
        }
      }
    }
  }

  // --- 5. adaptörün iş kuralları -------------------------------------------
  for (const p of units) {
    if (adapter.validateRow) await adapter.validateRow(p, ctx);
  }

  // --- 5b. AD MÜKERRER ön kontrolü ------------------------------------------
  // Guard servislerde (yazma yolunda) yaşıyor; önizleme onu çalıştırmazsa
  // "Yeni" der ve uygulama patlar. Adaptör varyantı beyan ettiyse burada aynı
  // kararı ÖNCEDEN veriyoruz — kapsam başına TEK sorgu.
  if (adapter.nameGuard) {
    checkDuplicateNamesInFile(adapter.nameGuard, units);
    await applyNameGuard(adapter.nameGuard, units);
  }

  // --- 6. hata varsa karar ERROR'a döner -----------------------------------
  for (const p of units) {
    if (p.result.errors.length > 0) p.result.action = "ERROR";
  }

  // ⚠️ Dönen liste GRUPLARDIR (gruplu adaptörde satır sayısından az olabilir) —
  // özet sayıları da kayıt bazlıdır, satır bazlı değil.
  return { prepared: units, unknownColumns: [...unknown] };
}

function summarize(results: ImportRowResult[]): ImportPreviewResult["summary"] {
  return {
    total: results.length,
    create: results.filter((r) => r.action === "CREATE").length,
    update: results.filter((r) => r.action === "UPDATE").length,
    skip: results.filter((r) => r.action === "SKIP").length,
    error: results.filter((r) => r.action === "ERROR").length,
    warning: results.filter((r) => r.warnings.length > 0).length,
  };
}

export class ImportService {
  /** İzinli varlık listesi (menü + panel). */
  static listEntities(permissions: string[]): Array<{
    entity: string;
    label: string;
    keyColumns: string[];
    canWrite: boolean;
    canRead: boolean;
  }> {
    // ⚠️ `matchesPermission` — gerçek kapı (`routes/import.routes.ts`) zaten onu
    // kullanıyor; burası yalnız LİSTE süslemesiydi ve süperadmine her satırı
    // `canRead:false` gösteriyordu ("ekran hayır, uç evet" tutarsızlığı).
    const has = (code: string): boolean =>
      matchesPermission(permissions, code) || matchesPermission(permissions, "admin:*");
    return listAdapters().map((a) => ({
      entity: a.entity,
      label: a.label,
      keyColumns: a.keyColumns,
      canWrite: has(a.writePermission),
      canRead: has(a.readPermission),
    }));
  }

  /** Şablon tarifi — panel bundan .xlsx üretir (backend xlsx YAZMAZ). */
  static template(entity: string): {
    entity: string;
    label: string;
    keyColumns: string[];
    columns: ImportColumn[];
    notes: string[];
  } {
    const a = getImportAdapter(entity);
    return {
      entity: a.entity,
      label: a.label,
      keyColumns: a.keyColumns,
      columns: a.columns,
      notes: [
        `Eşleşme anahtarı: ${a.keyColumns.join(" + ")}. Anahtar doluysa ve kayıt varsa GÜNCELLENİR, yoksa YENİ oluşturulur.`,
        "Boş hücre = o alana DOKUNULMAZ. Bir alanı temizlemek için hücreye NULL yazın.",
        "Zorunlu sütunlar yalnız YENİ kayıtta aranır.",
        "Sayı: 1234,5 veya 1234.5 · Tarih: GG.AA.YYYY · Evet/Hayır sütunları: Evet, Hayır.",
        "Çoklu değer taşıyan sütunlarda ayraç noktalı virgüldür (;).",
        ...(a.notes ?? []),
      ],
    };
  }

  /** Kuru koşum: satır satır ne olacağını döner, hiçbir şey yazmaz. */
  static async preview(
    entity: string,
    rows: ImportRowInput[],
    options: ImportOptions,
    userId?: string,
  ): Promise<ImportPreviewResult> {
    assertRowLimit(rows.length);
    const adapter = getImportAdapter(entity);
    const ctx = emptyContext(userId);
    const { prepared, unknownColumns } = await prepareRows(adapter, rows, options, ctx);
    const results = prepared.map((p) => p.result);
    return { entity, rows: results, summary: summarize(results), unknownColumns };
  }

  /**
   * Uygulama. Doğrulamayı SIFIRDAN koşar (önizlemeye güvenmez), sonra yazar.
   * `clientToken` verilmişse aynı token ile ikinci çağrı yeni kayıt YAZMAZ —
   * önceki koşumun sonucunu döner (timeout-retry ikizi).
   */
  static async apply(
    entity: string,
    rows: ImportRowInput[],
    options: ImportOptions,
    userId?: string,
  ): Promise<ImportApplyResult> {
    assertRowLimit(rows.length);
    const adapter = getImportAdapter(entity);
    const started = Date.now();

    if (options.clientToken) {
      const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });
      // ⚠️ SÜREN KOŞUM BAŞARI DEĞİLDİR (2026-08-29 / BULGU-T1-008).
      // Koşum kaydı eskiden SONDA yazılıyordu; 15 sn'lik istemci zaman aşımından
      // sonra kullanıcı "Uygula"ya tekrar bastığında bu sorgu hâlâ NULL dönüyor
      // ve dosya BAŞTAN yazılıyordu: 900 satırlık sipariş dosyası 1.800 sipariş
      // üretiyor, kullanıcı İKİ KEZ DE hata görüyordu (ikinci koşumun kayıt
      // yazımı `clientToken` P2002'sine düşüyor). Mükerrer sipariş = mükerrer
      // talep = sahte kumaş açığı ve iki kez üretim planı.
      // Kayıt artık BAŞTA yazılıyor; burada "hâlâ koşuyor"u 200 + "başarılı"
      // saymak, belirsiz durumu başarı ilan etmek olurdu.
      if (prior && prior.finishedAt === null) {
        throw AppError.conflict(
          "Bu yükleme HÂLÂ SÜRÜYOR — tekrar göndermeyin, aynı dosya iki kez yazılır. " +
            "Bitmesini bekleyin ve İçe Aktarım Geçmişi'nden sonucu görün. " +
            "Yükleme takıldıysa bu pencereyi kapatıp yeniden açın (yeni bir deneme başlatır).",
          { code: "IMPORT_IN_PROGRESS", runId: prior.id, startedAt: prior.createdAt },
        );
      }
      if (prior) {
        // Aynı deneme yeniden gönderildi — YAZMA, önceki sonucu döndür.
        return {
          entity,
          runId: prior.id,
          status: prior.status as ImportApplyResult["status"],
          created: prior.created,
          updated: prior.updated,
          skipped: prior.skipped,
          failed: prior.failed,
          durationMs: prior.durationMs,
          rows: (prior.errorReport as unknown as ImportRowResult[]) ?? [],
          summary: {
            total: prior.rowCount,
            create: prior.created,
            update: prior.updated,
            skip: prior.skipped,
            error: prior.failed,
            warning: 0,
          },
          unknownColumns: [],
          stoppedAtRowNo: prior.stoppedAtRowNo ?? undefined,
        };
      }
    }

    // ⚠️ Koşum kimliği ÖNCEDEN üretilir: audit satırları `importRunId` taşısın
    // diye. Kayıt sonda yazılsaydı, satır bazlı iz koşuma BAĞLANAMAZDI ve
    // "yanlış yükleme yaptım, ne oluştu?" sorusunun cevabı elle arkeoloji olurdu.
    const runId = crypto.randomUUID();

    // ── TOKEN'I ŞİMDİ CLAIM ET (BULGU-T1-008) ──────────────────────────────
    // Satır yazımı başlamadan ÖNCE. İki eşzamanlı istek aynı token'la gelirse
    // ikincisi burada P2002'ye düşer ve yukarıdaki kurala göre 409 alır —
    // "önce oku, sonra yaz" kontrolü tek başına yarışı kapatmıyordu.
    // ⚠️ Başlangıç statüsü `FAILED`: koşum bu noktada hiçbir şey yazmamıştır ve
    // süreç burada ölürse kayıt DOĞRU şeyi söyler. Sonda gerçek statüyle
    // güncelleniyor.
    if (options.clientToken) {
      try {
        await prisma.importRun.create({
          data: {
            id: runId,
            entity,
            userId: userId ?? null,
            fileName: options.fileName ?? null,
            clientToken: options.clientToken,
            rowCount: rows.length,
            status: "FAILED",
            options: { mode: options.mode ?? "upsert" } as unknown as object,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(
            "Bu yükleme HÂLÂ SÜRÜYOR (aynı anda ikinci kez gönderildi) — tekrar göndermeyin. " +
              "Bitmesini bekleyin ve İçe Aktarım Geçmişi'nden sonucu görün.",
            { code: "IMPORT_IN_PROGRESS" },
          );
        }
        throw e;
      }
    }


    // ⚠️ BURADAN SONRASI SARMALI (BULGU-T1-008): token yukarıda CLAIM EDİLDİ.
    // Gövde patlarsa (doğrulama hatası, adaptör arızası) satır `finishedAt`
    // NULL kalır ve o token SONSUZA DEK "hâlâ koşuyor" görünür — kullanıcı
    // aynı denemeyi tekrar gönderemez ve sebebini de anlamaz. Damgayı burada
    // basıyoruz: koşum bitti, sonuç başarısız.
    try {
      const ctx = emptyContext(userId);
      const { prepared, unknownColumns } = await prepareRows(adapter, rows, options, ctx);
      const results = prepared.map((p) => p.result);
      const errorRows = results.filter((r) => r.action === "ERROR");
      const onError = options.onError ?? "abort";
  
      if (errorRows.length > 0 && onError === "abort") {
        // Hiçbir şey yazılmadı. 400 gövdesinde satır sonuçları döner ki panel aynı
        // önizleme tablosunu hatalarla gösterebilsin.
        throw AppError.badRequest(
          `${errorRows.length} satırda hata var — hiçbir kayıt yazılmadı. Hataları düzeltip yeniden yükleyin ya da 'hatalı satırları atla' seçeneğini işaretleyin.`,
          { code: "IMPORT_VALIDATION_FAILED", rows: results, summary: summarize(results), unknownColumns },
        );
      }
  
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = errorRows.length;
      let stoppedAtRowNo: number | undefined;
      let status: ImportApplyResult["status"] = "APPLIED";
      const auditEntries: Array<{
        userId: string | undefined;
        action: "CREATE" | "UPDATE";
        tableName: string;
        recordId: string;
        newData: Record<string, unknown>;
      }> = [];
      // Defter satırları burada TOPLANIR, koşum satırı yazıldıktan SONRA basılır:
      // `ImportRunLine.importRunId` RESTRICT FK'dir ve token'sız koşumun `ImportRun`
      // satırı ancak aşağıdaki `upsert`te doğar.
      const ledgerLines: ImportRunLinePayload[] = [];
  
      for (const p of prepared) {
        if (p.result.action === "ERROR") continue;
        if (p.result.action === "SKIP") {
          skipped++;
          continue;
        }
        try {
          const out =
            p.result.action === "CREATE"
              ? await adapter.createOne(p, ctx)
              : await adapter.updateOne(p, ctx);
          if (p.result.action === "CREATE") created++;
          else updated++;
          p.result.targetId = out.id;
          auditEntries.push({
            userId,
            action: p.result.action === "CREATE" ? "CREATE" : "UPDATE",
            tableName: adapter.tableName,
            recordId: out.id,
            // `importRunId` iki soruyu birden cevaplar: "bu kayıt nasıl oluştu"
            // ve "bu koşumda neler oluştu". İkincisi olmadan hatalı bir yükleme
            // geri alınamaz (hangi kayıtların yazıldığı bilinmez).
            newData: { ...p.values, _source: "IMPORT", importRunId: runId },
          });
          // Audit DENETİM izidir (6 ayda arşivlenir, `oldData` yok); geri sarma bir İŞ
          // KARARIdır ve kalıcı kolondan okunur — bu yüzden aynı olay deftere de yazılır.
          ledgerLines.push(
            buildImportRunLine({
              entity,
              tableName: adapter.tableName,
              recordId: out.id,
              row: p,
              engineAction: p.result.action === "CREATE" ? "CREATE" : "UPDATE",
            }),
          );
        } catch (e) {
          // Doğrulama geçmişti ama yazma düştü (yarış / DB). DURUYORUZ: devam etmek
          // hasarı büyütür ve kullanıcı nerede kaldığını bilemez.
          failed++;
          stoppedAtRowNo = p.input.rowNo;
          p.result.action = "ERROR";
          p.result.errors.push({
            message: e instanceof Error ? e.message : "Yazma sırasında beklenmedik hata.",
          });
          status = created + updated > 0 ? "PARTIAL" : "FAILED";
          break;
        }
      }
  
      if (status === "APPLIED" && failed > 0) status = "PARTIAL";
  
      const durationMs = Date.now() - started;
      const finalResults = prepared.map((p) => p.result);
      const summary = summarize(finalResults);
  
      // Token'lı koşumun satırı BAŞTA yazıldı → burada GÜNCELLENİR; token'sız
      // (dahili/eski istemci) yolda hâlâ burada doğar. `upsert` ikisini de tek
      // ifadede karşılar ve "başta yazıldı mı" sorusunu koda taşımaz.
      const run = await prisma.importRun.upsert({
        where: { id: runId },
        update: {
          // Defter satırları koşum satırıyla AYNI ifadede yazılır: ayrı bir
          // `createMany` düşerse "koşum var ama defteri yok" doğar ve geri sarma
          // "hiçbir şey yazılmamış" diye YANLIŞ cevap verir.
          lines: { createMany: { data: ledgerLines } },
          rowCount: rows.length,
          created,
          updated,
          skipped,
          failed,
          status,
          durationMs,
          finishedAt: new Date(),
          stoppedAtRowNo: stoppedAtRowNo ?? null,
          options: { mode: options.mode ?? "upsert", onError } as unknown as object,
          errorReport: finalResults.filter(
            (r) => r.action === "ERROR" || r.warnings.length > 0,
          ) as unknown as object,
        },
        create: {
          id: runId,
          lines: { createMany: { data: ledgerLines } },
          finishedAt: new Date(),
          entity,
          userId: userId ?? null,
          fileName: options.fileName ?? null,
          clientToken: options.clientToken ?? null,
          rowCount: rows.length,
          created,
          updated,
          skipped,
          failed,
          status,
          durationMs,
          stoppedAtRowNo: stoppedAtRowNo ?? null,
          options: { mode: options.mode ?? "upsert", onError } as unknown as object,
          // Yalnız SORUNLU satırlar saklanır — 10.000 satırlık başarılı bir koşumun
          // tamamını JSON'a gömmek tabloyu şişirir ve hiçbir soruya cevap vermez.
          errorReport: finalResults.filter(
            (r) => r.action === "ERROR" || r.warnings.length > 0,
          ) as unknown as object,
        },
      });
  
      // Audit: satır bazlı toplu (perf kuralı 9) + koşumun kendisi tek olay.
      await AuditService.logMany(auditEntries);
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "IMPORT_RUN",
        userId: userId ?? null,
        tableName: adapter.tableName,
        recordId: run.id,
        payload: { entity, status, created, updated, skipped, failed, rowCount: rows.length, fileName: options.fileName ?? null },
      });
  
      return {
        entity,
        runId: run.id,
        status,
        created,
        updated,
        skipped,
        failed,
        durationMs,
        rows: finalResults,
        summary,
        unknownColumns,
        stoppedAtRowNo,
      };
    } catch (e) {
      if (options.clientToken) {
        await prisma.importRun
          .updateMany({
            where: { id: runId, finishedAt: null },
            data: { finishedAt: new Date(), status: "FAILED", durationMs: Date.now() - started },
          })
          .catch(() => {
            /* damga best-effort: asıl hatayı gölgelemesin */
          });
      }
      throw e;
    }
  }

  /** Geçmiş — kalıcı (audit 6 ayda arşivlenir, bu tablo kalır). */
  static async listRuns(params: { entity?: string; limit?: number }): Promise<unknown[]> {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    return prisma.importRun.findMany({
      where: params.entity ? { entity: params.entity } : {},
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        entity: true,
        fileName: true,
        rowCount: true,
        created: true,
        updated: true,
        skipped: true,
        failed: true,
        status: true,
        durationMs: true,
        stoppedAtRowNo: true,
        createdAt: true,
        user: { select: { id: true, username: true, fullName: true } },
      },
    });
  }

  /**
   * Bir koşumda DOKUNULAN kayıtlar — audit'ten (`newData.importRunId`).
   *
   * ⚠️ KAPSAM SINIRI, sessiz değil: koşum ÖZETİ kalıcıdır (`import_runs`), ama
   * satır bazlı iz AUDIT'tedir ve audit 6 ayda arşive taşınır. Yani "hangi
   * kayıtlar oluştu" sorusu 6 ay boyunca cevaplanır; sonrasında yanıt BOŞ döner
   * ve çağıran bunu `archivedAfterMonths` ile bilir (boş liste "hiçbir şey
   * oluşmadı" DEĞİLDİR — özetteki sayılara bak).
   */
  static async getRunRecords(id: string): Promise<{
    runId: string;
    records: Array<{ action: string; tableName: string; recordId: string; createdAt: Date }>;
    archivedAfterMonths: number;
  }> {
    const run = await prisma.importRun.findUnique({
      where: { id },
      // TARİH SEDDİ için okunuyor (aşağıya bak) — `id` tek başına yetmiyordu.
      select: { id: true, createdAt: true, finishedAt: true },
    });
    if (!run) throw AppError.notFound("İçe aktarım kaydı bulunamadı");
    // TARİH SEDDİ (2026-09-05 perf turu). jsonb path yüklemi indexlenemez →
    // sorgu system_logs'u baştan sona tarayıp sonucu ayrıca SIRALIYORDU:
    // ölçüldü 11,48 ms / 2.497 buffer (Seq Scan + Sort, 51.163 satır elendi).
    // Koşumun kendi penceresi doğal sınırdır: satır audit'i koşum başlamadan
    // yazılamaz, bittikten sonra da yalnız `logMany` gecikmesi kadar sürer.
    // ⚠️ ±10 dk pay ZORUNLU: `finishedAt` Node saatinden, `createdAt` DB
    // saatinden gelir (ölçüldü: token'sız koşumda finishedAt createdAt'ten 1-2 ms
    // ÖNCE) ve `logMany` damgadan SONRA koşar. `finishedAt` NULL = koşum sürüyor
    // → üst sınır bugün. Ölçüm: 1,33 ms / 1.529 buffer, Index Scan
    // (system_logs_createdAt_idx), Sort düğümü kayboldu; 75 audit satırının
    // 75'i pencerede kaldı (sonuç kümesi DEĞİŞMEDİ).
    const WINDOW_MS = 10 * 60_000;
    const rows = await prisma.systemLog.findMany({
      where: {
        category: "DOMAIN",
        createdAt: {
          gte: new Date(run.createdAt.getTime() - WINDOW_MS),
          lte: new Date((run.finishedAt ?? new Date()).getTime() + WINDOW_MS),
        },
        newData: { path: ["importRunId"], equals: id },
      },
      select: { action: true, tableName: true, recordId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 10000,
    });
    return {
      runId: id,
      records: rows.map((r) => ({
        action: r.action,
        tableName: r.tableName,
        recordId: r.recordId ?? "",
        createdAt: r.createdAt,
      })),
      archivedAfterMonths: 6,
    };
  }

  static async getRun(id: string): Promise<unknown> {
    const run = await prisma.importRun.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    });
    if (!run) throw AppError.notFound("İçe aktarım kaydı bulunamadı");
    return run;
  }

  /**
   * Round-trip dışa aktarım: aynı sütunlarla mevcut kayıtlar.
   *
   * `limit` ÖNİZLEME içindir ("indirmeden önce ilk N satıra bak"). Adaptörler
   * kendi `exportRows()`unda tümünü üretir — kesme burada yapılır; `total`
   * her zaman GERÇEK toplamı söyler, yoksa kullanıcı 10 kayıt var sanır.
   * ⚠️ Bu bir sayfalama DEĞİL: indirme yolu limitsiz çağırır. Bugünkü hacimde
   * (en büyük varlık 194 satır / 28 KB) tümünü üretip kesmek ölçülebilir bir
   * maliyet değil; sipariş/top ölçeğinde bir varlık eklenirse adaptörün
   * kendisi `take` almalı — o gün burası da imzayı geçirir.
   */
  static async exportRows(
    entity: string,
    opts?: { limit?: number },
  ): Promise<{
    entity: string;
    label: string;
    columns: ImportColumn[];
    rows: Array<Record<string, string>>;
    total: number;
    truncated: boolean;
  }> {
    const adapter = getImportAdapter(entity);
    const all = await adapter.exportRows();
    const limit = opts?.limit;
    const rows = limit && limit > 0 ? all.slice(0, limit) : all;
    return {
      entity: adapter.entity,
      label: adapter.label,
      columns: adapter.columns,
      rows,
      total: all.length,
      truncated: rows.length < all.length,
    };
  }
}

