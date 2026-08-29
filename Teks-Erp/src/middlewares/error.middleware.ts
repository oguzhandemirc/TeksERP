// =============================================================================
// TeksERP - Global Error Handler Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error";
import {
  BUYUK_GOVDE_LIMITI,
  VARSAYILAN_GOVDE_LIMITI,
  buyukGovdeYolu,
} from "../constants/body-limits";
import { AuditService } from "../services/audit.service";
import { classifyPoolTimeout, recordPoolTimeout, getPoolHealth } from "../lib/pool-health";
import "../types/express-augment";

/**
 * Prisma P2003 FK kolonunu farklı versiyon formatlarından çıkarır.
 * Prisma versiyon/adapter'ına göre meta yapısı değişir:
 *
 *   v5 (eski adapter):   meta.field_name = "OrderLine_itemId_fkey (index)"
 *   v6 (engine):         meta.field_name = "orders_customerId_fkey"
 *   v7 + pg adapter:     meta.driverAdapterError.cause.originalMessage =
 *                        '... violates foreign key constraint "orders_customerId_fkey"'
 *
 * Çıkarımı yapamazsak null döner; çağıran generic fallback mesajına düşer.
 */
function extractFkColumn(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;

  // Aday string'ler: meta.field_name + driverAdapterError.cause.originalMessage
  const candidates: string[] = [];
  if (typeof meta.field_name === "string") candidates.push(meta.field_name);

  const driverErr = meta.driverAdapterError as
    | { cause?: { originalMessage?: unknown; constraint?: unknown } }
    | undefined;
  const cause = driverErr?.cause;
  if (cause && typeof cause.originalMessage === "string") {
    candidates.push(cause.originalMessage);
  }
  if (cause && typeof cause.constraint === "string") {
    candidates.push(cause.constraint);
  }

  for (const raw of candidates) {
    // "table_fieldName_fkey" veya "Model_fieldName_fkey (index)"
    const m = raw.match(/_([a-zA-Z][a-zA-Z0-9]*)_fkey/);
    if (m) return m[1];
  }

  // Son çare: meta.field_name sadece field adı içeriyor (örn. "itemId")
  if (
    typeof meta.field_name === "string" &&
    /^[a-zA-Z][a-zA-Z0-9]*$/.test(meta.field_name)
  ) {
    return meta.field_name;
  }
  return null;
}

/**
 * P2002 mesajındaki kolon → kullanıcı etiketi. Yalnız ham kolon adının operatöre
 * anlamsız olduğu yerler; haritada olmayan kolon ham adıyla basılır (eski davranış).
 *
 * `nameFold` (2026-08-21): `customers/items/subcontractors` üzerindeki partial
 * UNIQUE (`<tablo>_nameFold_key`) ad mükerrerinin DB seddidir. Normal yolda
 * `assertNameNotDuplicate` ÖNCE ateşler ve Türkçe, kod bilgili 409'u o verir; bu
 * dal yalnız YARIŞ durumunda (iki istemci aynı anda aynı ad) ya da servisi atlayan
 * yazımda görünür — o zaman bile operatör "nameFold" değil "ad" okumalı.
 *
 * `nameFoldColor` (2026-08-25): renk seddi bir KOLON değil İFADE index'idir
 * (`colors_nameFoldColor_key` ON `tr_fold_color("name")`); constraint adından
 * çıkan "kolon" bu yüzden `nameFoldColor`dur — yine "ad" okunmalı.
 */
const UNIQUE_COLUMN_LABELS: Readonly<Record<string, string>> = {
  nameFold: "ad",
  nameFoldColor: "ad",
};
/** Katlanmış-ad seddi kolonları — P2002'de Türkçe "ad zaten kayıtlı" mesajı alır. */
const NAME_FOLD_COLUMNS: ReadonlySet<string> = new Set(["nameFold", "nameFoldColor"]);

/**
 * Prisma P2002 unique constraint kolon adını çıkarır.
 *   v6 engine:        meta.target = ["code"] veya "code"
 *   v7 + pg adapter:  meta.target boş; meta.driverAdapterError.cause
 *                     .originalMessage = '... violates unique constraint
 *                     "items_code_key"'
 *
 * Çoklu kolon (composite unique) için ilk kolonu döner; null/undefined varsa
 * çağıran "field" generic fallback'ine düşer.
 */
function extractUniqueColumn(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;

  const target = meta.target;
  if (Array.isArray(target) && target.length > 0 && typeof target[0] === "string") {
    return target[0] as string;
  }
  if (typeof target === "string" && target.length > 0) {
    return target;
  }

  // pg adapter: constraint adından çek ("items_code_key" → "code")
  const driverErr = meta.driverAdapterError as
    | { cause?: { originalMessage?: unknown; constraint?: unknown } }
    | undefined;
  const cause = driverErr?.cause;
  const candidates: string[] = [];
  if (cause && typeof cause.originalMessage === "string") {
    candidates.push(cause.originalMessage);
  }
  if (cause && typeof cause.constraint === "string") {
    candidates.push(cause.constraint);
  }
  for (const raw of candidates) {
    const m = raw.match(/_([a-zA-Z][a-zA-Z0-9]*)_key/);
    if (m) return m[1];
  }
  return null;
}

/**
 * 503 sözleşmesi TEK KAYNAK. İki dal aynı yanıtı döndürmek zorunda (havuz zaman
 * aşımı + Prisma P2028); metin ikiye ayrılırsa biri sessizce bayatlar.
 */
const SERVER_BUSY_MESSAGE = "Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin.";

/**
 * SYSTEM/ERROR audit recordId'si — havuz zaman aşımı. TARİHSEL satırlardan
 * AYIRT EDİLEBİLİR olması load-bearing: 2026-07-23 ve 2026-07-28 olayları
 * generic dala düştüğü için `recordId='Error'` ile yazıldı. İki sorgu da çalışır:
 *   eski:  recordId='Error' AND newData->>'message' ILIKE '%timeout%connect%'
 *   yeni:  recordId='POOL_TIMEOUT'
 * (Aynı recordId kullanılsaydı iki dönem birbirine karışırdı.)
 */
const POOL_TIMEOUT_RECORD_ID = "POOL_TIMEOUT";

/** CHECK ihlali audit'inde ayırt edici recordId (POOL_TIMEOUT emsali). */
const CHECK_VIOLATION_RECORD_ID = "CHECK_VIOLATION";

// =============================================================================
// Prisma kod SINIFLANDIRMASI (2026-08-09, denetim F-CORE-OPS-002)
// =============================================================================
// Yukarıdaki özel dallar (P2002/P2003/P2025/…) kendi mesajlarıyla döner. Bu iki
// küme, o dallara girmeyen kalan kodların NEREYE düşeceğini belirler ve karar
// TEK YERDE durur — eskiden karar yoktu, hepsi koşulsuz 400'e düşüyordu.
//
// ⚠️ Ayrımın ölçüsü "hata mesajı ne diyor" değil: **istemcinin gönderdiği veriyi
// değiştirerek bu hatadan kurtulabilir mi?** Kurtulabiliyorsa 400, kurtulamıyorsa
// (şema/bağlantı/sorgu arızası) 500 + audit.

/** Sunucu/şema arızası — 500 + SYSTEM/ERROR audit. İstemci veriyi değiştirerek kurtulamaz. */
const SERVER_FAULT_PRISMA_CODES = new Set<string>([
  "P2021", // tablo bulunamadı — yarım uygulanmış migration (D-23)
  "P2022", // kolon bulunamadı — şema drift (eski özel dal, davranışı korunuyor)
  "P2010", // ham sorgu başarısız ($queryRaw: raporlar, /health, tutarlılık kontrolleri)
  "P2015", // ilgili kayıt bulunamadı (ilişki çözümlenemedi)
  "P2017", // ilişki kayıtları bağlı değil
  "P2018", // gerekli bağlı kayıtlar bulunamadı
]);

/** İstemci verisi hatası — 400, audit YOK (gürültü olurdu). Davranış eskisiyle aynı. */
const CLIENT_DATA_PRISMA_CODES = new Set<string>([
  "P2000", // değer kolon için çok uzun
  "P2005", // kolon için geçersiz değer
  "P2006", // sağlanan değer geçersiz
  "P2011", // null kısıtı ihlali
  "P2012", // eksik zorunlu değer
  "P2013", // eksik zorunlu argüman
  "P2019", // girdi hatası
  "P2020", // aralık dışı değer (eski özel dal da var; burada yedek)
  "P2033", // sayı 64-bit tamsayıya sığmıyor
]);

/**
 * PostgreSQL CHECK constraint ihlali (SQLSTATE 23514) → constraint adı.
 *
 * ⚠️ İKİ FARKLI ŞEKİL var, ikisi de canlı DB'de ölçüldü (tahmin DEĞİL):
 *   • ORM yolu (`prisma.sack.update` vb.) → ÇIPLAK `DriverAdapterError`:
 *     `code`/`meta` YOK, bilgi `err.cause.code === "23514"` içinde. Bu yüzden
 *     `PrismaClientKnownRequestError` dalına HİÇ girmez ve eskiden generic 500'e
 *     düşerdi: operatör "Sunucu hatası oluştu." görür, audit'e
 *     `recordId='DriverAdapterError'` yazılır ve HANGİ kuralın patladığı ne yanıtta
 *     ne audit'te bulunurdu.
 *   • Ham sorgu yolu (`$executeRaw`) → `PrismaClientKnownRequestError` (P2010),
 *     bilgi `meta.driverAdapterError.cause.code` içinde.
 *
 * ⚠️ `cause.detail` İHLAL EDEN SATIRIN TÜM KOLON DEĞERLERİNİ taşır ("Failing row
 * contains (...)") → ASLA yanıta konmaz; yalnız sunucu log'una/audit'e gider.
 */
function extractCheckConstraint(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  const causes: Record<string, unknown>[] = [];
  // ORM yolu: hatanın kendisi DriverAdapterError.
  const own = e.cause;
  if (own && typeof own === "object") causes.push(own as Record<string, unknown>);
  // Ham sorgu yolu: PrismaClientKnownRequestError.meta.driverAdapterError.cause
  const meta = e.meta;
  if (meta && typeof meta === "object") {
    const dae = (meta as Record<string, unknown>).driverAdapterError;
    if (dae && typeof dae === "object") {
      const c = (dae as Record<string, unknown>).cause;
      if (c && typeof c === "object") causes.push(c as Record<string, unknown>);
    }
  }
  for (const c of causes) {
    if (c.code !== "23514" && c.originalCode !== "23514") continue;
    const msg = String(c.originalMessage ?? c.message ?? "");
    // '... violates check constraint "rolls_currentQty_nonneg"'
    return /check constraint "([^"]+)"/.exec(msg)?.[1] ?? "";
  }
  return null;
}

/**
 * Constraint adı → operatörün anlayacağı Türkçe sebep. Bilinmeyen constraint için
 * `null` → generic mesaj + constraint adı (ad teknik ama SABİT ve greplenebilir;
 * "bilinmeyen hata"dan iyidir).
 */
const CHECK_CONSTRAINT_MESSAGES: Record<string, string> = {
  rolls_currentQty_nonneg: "Top metrajı negatif olamaz.",
  rolls_initialQty_nonneg: "Topun giriş metrajı negatif olamaz.",
  rolls_weightKg_nonneg: "Top ağırlığı negatif olamaz.",
  sacks_weightKg_nonneg: "Çuval tartısı negatif olamaz.",
  order_lines_quantity_pos: "Sipariş satırı miktarı pozitif olmalı.",
  "order_lines_shippedQty_nonneg": "Sevk edilen miktar negatif olamaz.",
  work_order_steps_time_order: "Adımın bitiş zamanı başlangıcından önce olamaz.",
};

/**
 * Geçici sunucu tıkanıklığı yanıtı (havuz / transaction zaman aşımı).
 *
 * Retry-After bugün HİÇBİR istemci tarafından okunmuyor (Electron react-query
 * 5xx'te bir kez, mobil `stationRetry` jitter'lı üç kez dener; ikisi de header'a
 * bakmaz) ve CORS `exposedHeaders` listesinde olmadığı için renderer OKUYAMAZ
 * bile. Yine de 503'ün standart sözleşmesi budur ve curl/proxy seviyesinde
 * teşhisi netleştirir. Bir istemci gerçekten uyacaksa app.ts'teki
 * `exposedHeaders`'a da eklenmeli.
 */
function respondServerBusy(res: Response): void {
  res.setHeader("Retry-After", "3");
  res.status(503).json({ success: false, message: SERVER_BUSY_MESSAGE });
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // ⚠️ BAŞLIKLAR GÖNDERİLDİYSE YANITA DOKUNMA (2026-08-09, F-CORE-OPS-005).
  // Tek akış yanıtı `res.download` (admin yedek indirme). Aktarım ORTASINDA bir
  // okuma hatası olursa Express `next(err)` verir ve buraya düşeriz; aşağıdaki
  // dalların hepsi `res.status(...).json(...)` yazmaya çalışır ve
  // ERR_HTTP_HEADERS_SENT fırlatır. ÖLÇÜLDÜ (izole Express 5 sondası): süreç
  // ÖLMÜYOR — Express fırlatılanı yakalayıp finalhandler'a devrediyor, o da
  // soketi yok ediyor. Yani davranış zaten "bağlantıyı kes"ti; kazanılan şey
  // TEŞHİS: eski hâlde audit satırı, ASIL hatayı değil onu bildirme girişiminin
  // hatasını (ERR_HTTP_HEADERS_SENT) kaydediyordu ve teşhis yanlış yöne gidiyordu.
  // Şimdi asıl hata konsola kendi bağlamıyla düşüyor, sahte audit satırı doğmuyor.
  if (res.headersSent) {
    console.error(
      `[error.middleware] Yanıt zaten başlamıştı (${req.method} ${req.originalUrl}) — ` +
        `bağlantı kesiliyor. Asıl hata:`,
      err,
    );
    _next(err); // Express finalhandler: başlıklar gönderilmişse soketi yok eder.
    return;
  }

  // Known operational errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // JSON parse errors (malformed request body)
  if (err instanceof SyntaxError && "status" in err && (err as SyntaxError & { status: number }).status === 400) {
    res.status(400).json({
      success: false,
      message: "Geçersiz JSON formatı. İstek gövdesini kontrol edin.",
    });
    return;
  }

  // F16: express.json({ limit: "1mb" }) aşıldığında body-parser 'entity.too.large'
  // fırlatır — generic 500 yerine net 413 Türkçe.
  if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({
      success: false,
      // Sınır METİNDE sabit yazılmaz: içe aktarım yolları 10 MB'lık kendi
      // katmanlarını taşıyor ve "1MB" demek operatöre yanlış sınırı söylerdi.
      message:
        `İstek gövdesi çok büyük (${buyukGovdeYolu(req.originalUrl) ? BUYUK_GOVDE_LIMITI : VARSAYILAN_GOVDE_LIMITI} sınırı aşıldı). ` +
        "Daha az kayıtla tekrar deneyin.",
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // pg havuzu zaman aşımı (ÇIPLAK Error) → 503 + tekrar-dene sinyali
  // ---------------------------------------------------------------------------
  // Prisma 7 + @prisma/adapter-pg'de Rust query-engine YOK → havuz hatası ASLA
  // P2024 üretmez; aşağıdaki P2024 dalı bu kurulumda ULAŞILAMAZ (doğrulandı:
  // `grep -rl P2024 node_modules/@prisma/` → sıfır dosya). pg-pool iki çıplak
  // `Error` fırlatır, adapter'ın convertDriverError'ı (kod/severity taşımadıkları
  // için) onları HAM geçirir ve Prisma da sarmalamaz → eskiden en alttaki generic
  // dala düşüp 500 "Sunucu hatası oluştu." dönüyorlardı.
  //
  // Canlıda iki kez yaşandı — 2026-07-23 14:05:34 ve 2026-07-28 23:59:19 — ikisi
  // de havuz DOLULUĞU değil SOĞUK CONNECT kaynaklı (bkz. lib/prisma.ts havuz
  // yorumu). İstemci verisi hatası DEĞİL → 503, P2028 ile aynı sözleşme.
  //
  // KONUM: AppError / SyntaxError / 413'ten SONRA (onlar önce dönmeli), Prisma
  // bloğundan ÖNCE. İki dal kanıtlanabilir şekilde AYRIK: classifyPoolTimeout
  // `err.constructor === Error` istiyor, bir Prisma hatası bunu asla geçemez.
  const poolTimeoutKind = classifyPoolTimeout(err);
  if (poolTimeoutKind) {
    recordPoolTimeout(poolTimeoutKind, err.message);
    const p = getPoolHealth();
    console.error(
      `[error.middleware] Havuz zaman aşımı (${poolTimeoutKind}): ${err.message} — ` +
        `total=${p.poolTotalCount} idle=${p.poolIdleCount} waiting=${p.poolWaitingCount}/${p.poolMax}`
    );
    void AuditService.logEvent({
      category: "SYSTEM",
      action: "ERROR",
      userId: req.user?.userId,
      recordId: POOL_TIMEOUT_RECORD_ID,
      ipAddress: req.ip ?? null,
      payload: {
        kind: poolTimeoutKind,
        message: err.message,
        method: req.method,
        path: req.originalUrl,
        // Teşhis kilidi: doygunluk mu soğuk-connect mi? Bir daha "acaba havuz
        // dolu muydu" diye tahmin etmeyelim — olay anındaki sayaçlar burada.
        poolTotal: p.poolTotalCount,
        poolIdle: p.poolIdleCount,
        poolWaiting: p.poolWaitingCount,
        poolMax: p.poolMax,
        stack: err.stack?.split("\n").slice(0, 8).join("\n"),
      },
    });
    respondServerBusy(res);
    return;
  }

  // CHECK constraint ihlali (23514) — Prisma known-error dalından ÖNCE, çünkü ORM
  // yolunda hata ÇIPLAK DriverAdapterError olarak gelir ve o dala hiç girmez.
  //
  // Statü seçimi: 400 "doğrulama hatası" DEĞİL. 23514 istemci verisinin biçim hatası
  // değil, "uygulama guard'ı eksik ya da satır zaten kirli" demektir — 400 demek
  // teşhisi körleştirir ve operatöre "girdini düzelt" der (düzeltecek bir girdi yok).
  // 409 Conflict: "veri bu işleme uygun durumda değil". Her durumda SYSTEM/ERROR
  // audit'e yazılır ki canlıda kaç kez tetiklendiği ÖLÇÜLEBİLSİN.
  const checkConstraint = extractCheckConstraint(err);
  if (checkConstraint !== null) {
    const friendly = CHECK_CONSTRAINT_MESSAGES[checkConstraint];
    const message = friendly
      ? `${friendly} İşlem tamamlanmadı.`
      : `Veri bütünlüğü kuralı engelledi (${checkConstraint || "bilinmeyen kural"}) — işlem tamamlanmadı. ` +
        "Kayıt beklenmeyen bir durumda; yöneticinize bu kuralın adını iletin.";
    console.error(`[error.middleware] CHECK ihlali (23514): ${checkConstraint} — ${err.message}`);
    void AuditService.logEvent({
      category: "SYSTEM",
      action: "ERROR",
      userId: req.user?.userId,
      recordId: CHECK_VIOLATION_RECORD_ID,
      ipAddress: req.ip ?? null,
      payload: {
        constraint: checkConstraint,
        method: req.method,
        path: req.originalUrl,
        // `detail` (ihlal eden satırın TÜM kolon değerleri) BİLEREK alınmıyor —
        // audit'e de girse operatör ekranına sızma yüzeyi büyür; constraint adı
        // + istek yolu teşhis için yeterli.
        message: err.message?.slice(0, 300),
      },
    });
    res.status(409).json({ success: false, message });
    return;
  }

  // Prisma known request errors
  // F25: instanceof (bundler-güvenli) + constructor.name (fallback).
  if (err instanceof Prisma.PrismaClientKnownRequestError || err.constructor.name === "PrismaClientKnownRequestError") {
    const prismaErr = err as Error & { code: string; meta?: Record<string, unknown> };

    if (prismaErr.code === "P2002") {
      const col = extractUniqueColumn(prismaErr.meta);
      if (!col) {
        // Bilinmeyen format — debug için audit log
        console.warn(
          `[error.middleware] P2002 column extract failed. meta=`,
          prismaErr.meta
        );
      }
      const label = col ?? "field";
      res.status(409).json({
        success: false,
        message:
          col != null && NAME_FOLD_COLUMNS.has(col)
            ? // Katlanmış ad seddi: "MODA TEKSTİL" ≡ "Moda Tekstil" ≡ "moda tekstil";
              // renkte ayrıca "055-BEYAZ" ≡ "BEYAZ 055".
              "Bu ad zaten kayıtlı (büyük/küçük harf ve Türkçe karakter farkı sayılmaz)."
            : `Bu '${UNIQUE_COLUMN_LABELS[label] ?? label}' değeri zaten mevcut (unique constraint).`,
      });
      return;
    }

    if (prismaErr.code === "P2025") {
      res.status(404).json({
        success: false,
        message: "Kayıt bulunamadı.",
      });
      return;
    }

    // P2003 — Foreign key constraint failed.
    // meta.field_name format Prisma versiyonuna göre değişir:
    //   - "OrderLine_itemId_fkey (index)"  → eski
    //   - "orders_customerId_fkey"          → yeni
    //   - "itemId"                          → bazen sade
    // Generic kullanıcı için: "X alanı için belirtilen kayıt bulunamadı."
    // Service-level explicit existence check (örn. OrderService.validateCustomer)
    // varsa zaten 404/400 dönüyor; buraya düşen FK ihlali = client geçersiz UUID
    // göndermiş ve service o FK için validation yazmamış.
    if (prismaErr.code === "P2003") {
      const field = extractFkColumn(prismaErr.meta);
      const fieldLabel = field ?? "ilişkili alan";
      if (!field) {
        // Prisma versiyonu bilinmeyen bir format gönderdi — debug için logla.
        console.warn(
          `[error.middleware] P2003 field extract failed. meta=`,
          prismaErr.meta
        );
      }
      res.status(400).json({
        success: false,
        message: `Geçersiz referans: '${fieldLabel}' için belirtilen kayıt bulunamadı veya silinmiş.`,
      });
      return;
    }

    // P2007 — Data validation error (örn. uuid kolonuna geçersiz formatlı
    // string). L (düşük bulgu): eskiden generic dala düşüp belirsiz mesaj +
    // console gürültüsü üretiyordu; net 400'e eşlendi.
    if (prismaErr.code === "P2007") {
      res.status(400).json({
        success: false,
        message: "Geçersiz veri formatı (örn. hatalı ID). Gönderilen değerleri kontrol edin.",
      });
      return;
    }

    // F65: P2023 — Inconsistent column data (örn. UUID kolonuna geçersiz path param).
    // Generic dala düşmesin → net 400.
    if (prismaErr.code === "P2023") {
      res.status(400).json({
        success: false,
        message: "Geçersiz ID formatı (beklenen: UUID). Adresi kontrol edin.",
      });
      return;
    }

    // P2020 — Value out of range for the type.
    // Yüksek sayı, taşmış decimal, geçersiz tarih vb.
    if (prismaErr.code === "P2020") {
      res.status(400).json({
        success: false,
        message: "Sayısal değer izin verilen aralık dışında. Daha küçük bir değer deneyin.",
      });
      return;
    }

    // P2022 — Column not found (schema drift). KARDEŞLERİYLE BİRLİKTE (2026-08-09,
    // F-CORE-OPS-002): aynı kazanın farklı ayakları aynı muameleyi görmeli.
    //   P2021 — tablo bulunamadı  (migration yarım uygulandı; D-23: `migrate resolve
    //           --applied` SQL'in KOŞTUĞUNU doğrulamaz, statement_timeout'ta kesilen
    //           DDL sessizce "uygulandı" görünür)
    //   P2010 — ham sorgu başarısız ($queryRaw yolu: raporlar, /health, tutarlılık)
    //   P2015/P2017/P2018 — ilişki/bağlantı kaydı çözülemedi (şema ya da veri arızası)
    // Bunlar İSTEMCİ VERİSİ HATASI DEĞİLDİR; 400 dönmek operatörü kendi girdisini
    // kontrol etmeye gönderir ve gerçek sebep (drift) hiçbir deftere düşmez.
    if (SERVER_FAULT_PRISMA_CODES.has(prismaErr.code)) {
      console.error(
        `[error.middleware] Sunucu/şema arızası (${prismaErr.code}):`,
        prismaErr.meta,
      );
      // F21: 5xx'e eşlenen şema-drift incident'i de SYSTEM/ERROR audit'e/metriğe düşsün.
      void AuditService.logEvent({
        category: "SYSTEM",
        action: "ERROR",
        userId: req.user?.userId,
        recordId: prismaErr.code,
        ipAddress: req.ip ?? null,
        payload: { code: prismaErr.code, method: req.method, path: req.originalUrl },
      });
      res.status(500).json({
        success: false,
        message: "Sunucu yapılandırma hatası. Lütfen yöneticiyle iletişime geçin.",
      });
      return;
    }

    // P2014 — Required relation change violated.
    if (prismaErr.code === "P2014") {
      res.status(400).json({
        success: false,
        message: "İlişki kuralı ihlali: zorunlu bağlı kayıt değiştirilemez.",
      });
      return;
    }

    // F21: P2034 — write conflict / deadlock (eşzamanlı çakışan işlem). İstemci
    // verisi hatası DEĞİL → 409 + retry sinyali. (Atomik-claim yolları zaten 409
    // döner; bu, ORM/engine seviyesinde kaçan serialization/deadlock içindir.)
    if (prismaErr.code === "P2034") {
      res.status(409).json({
        success: false,
        message: "İşlem şu anda başka bir işlemle çakıştı. Lütfen tekrar deneyin.",
      });
      return;
    }

    // F21: P2028 (interaktif transaction zaman aşımı) — sunucu tarafı tıkanıklık
    // → 503 + SYSTEM/ERROR audit (5xx izleme/metriğe düşsün).
    //
    // P2024 (havuz zaman aşımı) bu kurulumda ÖLÜ: driver adapter kullanıldığı için
    // Rust havuzu yok, Prisma P2024 ÜRETEMEZ (`grep -rl P2024 node_modules/@prisma/`
    // → sıfır dosya). Testi savunma amaçlı BIRAKTIK (adapter'sız bir yapılandırmaya
    // dönülürse çalışsın). GERÇEK havuz zaman aşımı yukarıdaki classifyPoolTimeout
    // dalında yakalanır — ÇIPLAK Error olarak gelir, buraya hiç uğramaz.
    if (prismaErr.code === "P2024" || prismaErr.code === "P2028") {
      console.error(`[error.middleware] Prisma ${prismaErr.code} (sunucu tıkanıklık):`, prismaErr.meta);
      void AuditService.logEvent({
        category: "SYSTEM",
        action: "ERROR",
        userId: req.user?.userId,
        recordId: prismaErr.code,
        ipAddress: req.ip ?? null,
        payload: { code: prismaErr.code, method: req.method, path: req.originalUrl },
      });
      respondServerBusy(res); // gövde/mesaj AYNI (SERVER_BUSY_MESSAGE) + Retry-After
      return;
    }

    // İstemci verisinden kaynaklanabilecek KALAN kodlar → 400 (davranış korunur).
    if (CLIENT_DATA_PRISMA_CODES.has(prismaErr.code)) {
      console.error(`[error.middleware] İstemci verisi hatası ${prismaErr.code}:`, prismaErr.meta);
      res.status(400).json({
        success: false,
        message: "İstek işlenemedi. Gönderilen veriyi kontrol edin.",
      });
      return;
    }

    // TANINMAYAN kod → FAIL-LOUD (2026-08-09, F-CORE-OPS-002). Eskiden burası
    // koşulsuz 400 dönüyor ve audit YAZMIYORDU: sunucu kaynaklı bir arıza istemci
    // hatası gibi görünüyor, SystemLog'da iz bırakmıyor ve /health sağlıklı
    // kalıyordu. Varsayılanı sunucu tarafına almak bilinçli: yanlışlıkla 500 demek,
    // gerçek bir drift'i 400 olarak yutmaktan ucuzdur. Yeni bir Prisma kodu
    // görüldüğünde yukarıdaki iki kümeden birine YAZILMALI — bu dal bir uyarıdır.
    console.error(
      `[error.middleware] SINIFLANDIRILMAMIŞ Prisma kodu ${prismaErr.code} ` +
        `(sunucu arızası varsayıldı — kodu error.middleware'deki iki kümeden birine ekleyin):`,
      prismaErr.meta,
    );
    void AuditService.logEvent({
      category: "SYSTEM",
      action: "ERROR",
      userId: req.user?.userId,
      recordId: prismaErr.code,
      ipAddress: req.ip ?? null,
      payload: {
        code: prismaErr.code,
        unclassified: true,
        method: req.method,
        path: req.originalUrl,
      },
    });
    res.status(500).json({
      success: false,
      message: "Sunucu hatası oluştu.",
    });
    return;
  }

  // Prisma validation errors (wrong data shape for model)
  if (err instanceof Prisma.PrismaClientValidationError || err.constructor.name === "PrismaClientValidationError") {
    res.status(400).json({
      success: false,
      message: "Geçersiz veri yapısı. Gönderilen alanları ve tipleri kontrol edin.",
    });
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError || err.constructor.name === "ZodError") {
    const zodErr = err as Error & { issues: Array<{ path: (string | number)[]; message: string }> };
    res.status(400).json({
      success: false,
      message: "Validasyon hatası",
      errors: zodErr.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // Unknown / unexpected errors → SystemLog'a SYSTEM/ERROR yaz.
  // AppError ve bilinen validation/Prisma error'ları yukarıda 4xx olarak
  // dönmüş; buraya düşen her şey gerçek 5xx olarak değerlendirilir.
  console.error("Unhandled Exception:", err);

  void AuditService.logEvent({
    category: "SYSTEM",
    action: "ERROR",
    userId: req.user?.userId,
    recordId: err.name || "UnhandledException",
    ipAddress: req.ip ?? null,
    payload: {
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 8).join("\n"),
      method: req.method,
      path: req.originalUrl,
    },
  });

  res.status(500).json({
    success: false,
    message: "Sunucu hatası oluştu.",
  });
};
