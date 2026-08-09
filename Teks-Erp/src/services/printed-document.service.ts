// =============================================================================
// Printed Document Service — yazdırılabilir resmi belge defteri (versiyonlu)
// =============================================================================
// Endüstri standardı belge yaşam döngüsü:
//   TASLAK (kaynak henüz resmileşmedi — bu tabloda satır YOK, client canlı render)
//     → FREEZE (sevk olayı anında v1 ACTIVE; içerik + şablon override + künye donar)
//     → REISSUE (gerekçeli düzeltme: vN SUPERSEDED, vN+1 ACTIVE güncel veriden donar)
//     → VOID (kaynak iptal: ACTIVE belge VOIDED — baskıda İPTAL filigranı)
// Yeni sevk OLAYI = yeni sourceId = yepyeni belge zinciri; eski belgeye dokunulmaz.
//
// Bu servis domain bilmez: her belge tipi kendi snapshot builder'ını register eder
// (domain servis → bu servis tek yönlü bağımlılık; döngü yok). Builder'lar hem
// freeze (sevk anı, tx içinde) hem reissue (güncel veriden) hem lazy-init
// (eski kayıt geriye dönük) yollarında kullanılır.
// =============================================================================

import { Prisma, PrintedDocType, PrintedDocStatus } from "@prisma/client";
import bwipjs from "bwip-js";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  readCompanyName,
  readCompanyLetterhead,
  readDocumentsConfig,
  readDocumentsLogo,
  sanitizeDocumentsConfig,
  type CompanyLetterhead,
  type DocumentConfig,
} from "./system-setting.service";
import { ApiResponse } from "../types/api.types";
import { SAMPLE_PRINTED_DOCS } from "./document-render/sample-data";

/** Builder'ların aldığı istemci — tx içinden (freeze) veya dışından (reissue/lazy) çalışır. */
export type PrintedDocDb = Prisma.TransactionClient | typeof prisma;
type Db = PrintedDocDb;

/** docType → belge ayar anahtarı (client DOC_DEFS / resolveDocConfig ile aynı key). */
const DOC_CONFIG_KEYS: Record<PrintedDocType, string> = {
  SHIPMENT_DISPATCH: "shipmentDispatch",
  SUBCONTRACTOR_DISPATCH: "fasonSevk",
  SUBCONTRACTOR_DIRECT_SHIP: "fasonDirectShip",
  KARTELA_DISPATCH: "kartelaCeki",
  SUBCONTRACTOR_RECEIPT: "fasonKabul",
  QUALITY_CERTIFICATE: "kaliteSertifikasi",
  RETURN_DISPATCH: "iadeIrsaliyesi",
};

/** Snapshot zarfı — `doc` tip-bazlı payload, geri kalanı ortak meta. */
export interface PrintedDocSnapshot {
  schemaVersion: 1;
  frozenAt: string;
  /** logoHash: freeze anındaki logo referansı (base64 KOPYASI DEĞİL — kütüphane
   *  hash'i; DOCUMENTS_LOGO append-only olduğu için eski belge kendi logosunu bulur).
   *  Eski snapshot'larda alan yok → logo basılmaz. */
  company: { name: string; letterhead: CompanyLetterhead; logoHash?: string | null };
  /** Freeze anındaki HAM şablon override'ı — client resolveDocConfig ile çözer.
   *  Çözülmüş hali DEĞİL: DOC_DEFS varsayılanları client'ta tek kaynak kalsın
   *  diye (4. manuel senkron noktası açmamak için) ham saklanır. */
  docConfigOverride: DocumentConfig | null;
  doc: Record<string, unknown>;
}

/** Builder çıktısı — domain servisin freeze/reissue için ürettiği içerik. */
export interface BuiltDocContent {
  documentNo: string;
  doc: Record<string, unknown>;
  /** Kaynak iptal edilmişse (lazy-init yolu) belge doğrudan VOIDED doğar. */
  voidInfo?: { reason: string | null; at: Date } | null;
}

/** null dönüş = kaynak bu belge için uygun durumda değil (örn. Shipment henüz
 *  DISPATCHED değil → client TASLAK modunda canlı render eder). */
export type PrintedDocBuilder = (db: Db, sourceId: string) => Promise<BuiltDocContent | null>;

interface BuilderEntry {
  /** Güncel veriden üretir — freeze (sevk anı) ve reissue yolu. */
  fresh: PrintedDocBuilder;
  /** Eski kayıt için geriye dönük üretim (örn. legacy printSnapshot kolonunu
   *  taşı). Verilmezse `fresh` kullanılır. */
  lazyInit?: PrintedDocBuilder;
  /** Kaynak henüz donmamışken (TASLAK) canlı veriden içerik üretir — getHtml
   *  `allowDraft` yolu bunu transient (kaydedilmeyen) snapshot'a sarar ve
   *  renderHtml'i `draft:true` ile çağırır. Verilmezse taslak → 409. */
  buildPreview?: PrintedDocBuilder;
  /** Kaynağın belge şablon PROFİLİNİ çözer (müşteri/fason ataması) — freeze/render
   *  anında genel config üstüne merge edilir. Verilmezse profil uygulanmaz. */
  resolveProfileId?: (db: Db, sourceId: string) => Promise<string | null>;
  /** Kaynağa ait KAYITLI serbest notu (annotation) canlı çözer — render'da
   *  meta.printNote yerine geçer. Donmuş çekirdeğe GİRMEZ; her an düzenlenebilir,
   *  tekrar baskıda çıkar. Verilmezse ephemeral ?printNote= kullanılır. Yalnız
   *  sevk irsaliyesi uygular (shipment.dispatchNote). */
  resolveLiveNote?: (db: Db, sourceId: string) => Promise<string | null>;
  /**
   * SATIR-BAZLI kayıtlı notları (annotation) canlı çözer — anahtar → not.
   * `resolveLiveNote` belge başına TEK not döner; bu ise tablo satırlarına
   * eşlenen notlar içindir (sevk irsaliyesi çuval tablosu → sackNo → yorum).
   *
   * Donmuş çekirdeğe GİRMEZ (collectShipmentDocContent'e dokunulmaz): sevkten
   * sonra yazılan yorum da basılabilir, `schemaVersion` artmaz, eski snapshot'lar
   * etkilenmez. HER baskıda koşar (kolon kapalı olsa da) — ucuz tek sorgu;
   * görünürlük kararını renderer verir, böylece bu katman belge config'ini
   * okumak zorunda kalmaz.
   */
  resolveLiveRowNotes?: (db: Db, sourceId: string) => Promise<Record<string, string>>;
  /** Donmuş snapshot'tan baskı-hazır HTML üretir — TEK KAYNAK format (mobil +
   *  Electron aynı HTML'i basar). Verilmezse o belge tipi için `getHtml` 400 verir. */
  renderHtml?: (
    snapshot: PrintedDocSnapshot,
    meta: {
      status?: PrintedDocStatus;
      voidReason?: string | null;
      draft?: boolean;
      /** Snapshot'taki logoHash'in çözülmüş görseli (servis katmanı çözer). */
      logoDataUrl?: string | null;
      /** cfg.qr açıksa belge no+versiyon karekodu (servis üretir). */
      qrDataUrl?: string | null;
      /** Basım anı (dd.MM.yyyy HH:mm) — cfg.stamps.printedAt açıksa basılır. */
      printedAtText?: string;
      /** Baskıyı isteyen kullanıcı — cfg.stamps.printedBy açıksa basılır. */
      printedBy?: string | null;
      /** Tek seferlik baskı notu (persist edilmez, ?printNote=). */
      printNote?: string | null;
      /** Satır-bazlı kayıtlı notlar (resolveLiveRowNotes çıktısı) — ör. sackNo → yorum. */
      rowNotes?: Record<string, string>;
      /**
       * Tek seferlik "satır notlarını bu baskıda göster" (?rowNotes=1) — kalıcı
       * kolon ayarını EZER (OR ilişkisi), hiçbir yere YAZILMAZ. Renderer bunu
       * efektif kolon ayarına çevirir.
       */
      forceRowNotes?: boolean;
      /** Tek seferlik liste seçimi (?sections=) — tanımayan renderer yok sayar. */
      listSections?: string[];
      /** Listeleri aynı sayfada akıt (?merge=1) — varsayılan ayrı sayfalar. */
      mergeSections?: boolean;
    },
  ) => string;
}

const builders = new Map<PrintedDocType, BuilderEntry>();

export function registerPrintedDocBuilder(docType: PrintedDocType, entry: BuilderEntry): void {
  builders.set(docType, entry);
}

function requireBuilder(docType: PrintedDocType): BuilderEntry {
  const entry = builders.get(docType);
  if (!entry) throw AppError.internal(`Belge builder kayıtlı değil: ${docType}`);
  return entry;
}

async function buildSnapshotEnvelope(
  db: Db,
  docType: PrintedDocType,
  doc: Record<string, unknown>,
  sourceId?: string
): Promise<PrintedDocSnapshot> {
  const [companyName, letterhead, documentsConfig, logo] = [
    await readCompanyName(db),
    await readCompanyLetterhead(db),
    await readDocumentsConfig(db),
    await readDocumentsLogo(db),
  ];

  // Çözüm zinciri: genel DOCUMENTS_CONFIG → kaynağın müşteri/fason PROFİLİ.
  // Merge alan-düzeyi shallow'dur: profilde verilen alan (sections/columns/style
  // dahil) BÜTÜN olarak genel ayarı ezer. Sonuç ham override olarak donar —
  // eski belgeler profil sonradan değişse bile kendi görünümüyle basılır.
  const docKey = DOC_CONFIG_KEYS[docType];
  let docCfg: DocumentConfig | null = documentsConfig[docKey] ?? null;
  const resolveProfileId = builders.get(docType)?.resolveProfileId;
  if (sourceId && resolveProfileId) {
    const profileId = await resolveProfileId(db, sourceId);
    if (profileId) {
      const profile = await db.documentProfile.findUnique({
        where: { id: profileId },
        select: { config: true, isActive: true },
      });
      if (profile?.isActive && profile.config && typeof profile.config === "object") {
        const pCfg = sanitizeDocumentsConfig(profile.config as Record<string, unknown>)[docKey];
        if (pCfg) docCfg = { ...(docCfg ?? {}), ...pCfg };
      }
    }
  }

  return {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    company: { name: companyName, letterhead, logoHash: logo.current },
    docConfigOverride: docCfg,
    doc,
  };
}

/** JSON değerini anahtar sırasından bağımsız karşılaştırmak için kanonikleştir
 *  (jsonb okurken anahtar sırası değişebilir → aksi halde yanlış "farklı" sonucu). */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    return Object.keys(src)
      .sort()
      .reduce<Record<string, unknown>>((o, k) => {
        o[k] = canonicalize(src[k]);
        return o;
      }, {});
  }
  return v;
}
const jsonEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));

/** Donmuş görünüm katmanı (docConfigOverride + firma adı/künye/logo) güncel çözülenden
 *  FARKLI mı? "Güncel görünüm" tuşunu yalnız gerçekten farklıysa göstermek için. İçerik
 *  (`doc`) donuk kalır, karşılaştırmaya girmez. */
async function isTemplateStale(
  db: Db,
  docType: PrintedDocType,
  sourceId: string,
  snap: PrintedDocSnapshot,
): Promise<boolean> {
  const fresh = await buildSnapshotEnvelope(db, docType, snap.doc, sourceId);
  return (
    !jsonEqual(fresh.docConfigOverride, snap.docConfigOverride) ||
    fresh.company.name !== snap.company.name ||
    !jsonEqual(fresh.company.letterhead, snap.company.letterhead) ||
    (fresh.company.logoHash ?? null) !== (snap.company.logoHash ?? null)
  );
}

/** Snapshot'taki logo referansını kütüphaneden çözer (hash yoksa/silinmişse null). */
async function resolveLogoDataUrl(snapshot: PrintedDocSnapshot): Promise<string | null> {
  const hash = snapshot.company?.logoHash;
  if (!hash) return null;
  const logo = await readDocumentsLogo();
  return logo.items[hash] ?? null;
}

/** dd.MM.yyyy HH:mm (Basım damgası). */
function fmtStampNow(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Render meta ekleri — logo + (cfg.qr açıksa) belge no/versiyon karekodu + basım
 * damgaları. QR içeriği insan-okur doğrulama satırıdır: "BELGENO vN".
 */
async function buildRenderExtras(
  snapshot: PrintedDocSnapshot,
  info: { documentNo?: string; version?: number; printedBy?: string | null; printNote?: string | null },
): Promise<{
  logoDataUrl: string | null;
  qrDataUrl: string | null;
  printedAtText: string;
  printedBy: string | null;
  printNote: string | null;
}> {
  let qrDataUrl: string | null = null;
  if (snapshot.docConfigOverride?.qr) {
    const text = info.documentNo
      ? `${info.documentNo}${info.version ? ` v${info.version}` : ""}`
      : "ORNEK-BELGE";
    const buf = await bwipjs.toBuffer({ bcid: "qrcode", text, scale: 3 });
    qrDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  }
  return {
    logoDataUrl: await resolveLogoDataUrl(snapshot),
    qrDataUrl,
    printedAtText: fmtStampNow(),
    printedBy: info.printedBy ?? null,
    printNote: info.printNote?.trim().slice(0, 300) || null,
  };
}

export class PrintedDocumentService {
  /**
   * FREEZE — sevk olayı anında v1 belgeyi dondurur. Domain servisin sevk
   * transaction'ı İÇİNDEN çağrılır: sevk başarılıysa belge de garantidir
   * (tx rollback'inde ikisi birlikte gider). Audit, çağıranın sevk audit'inde.
   */
  async freezeForSource(
    tx: Prisma.TransactionClient,
    docType: PrintedDocType,
    sourceId: string,
    userId?: string,
    /** Revizyon gerekçesi — yalnız `reissueForSourceTx` üzerinden gelir (v1'de boş). */
    reissueReason?: string,
  ): Promise<void> {
    const built = await requireBuilder(docType).fresh(tx, sourceId);
    if (!built) {
      throw AppError.internal(`Belge dondurulamadı — kaynak uygun durumda değil: ${docType}/${sourceId}`);
    }
    const snapshot = await buildSnapshotEnvelope(tx, docType, built.doc, sourceId);
    // VERSİYON SABİT 1 DEĞİL (2026-08-05): bir kaynak İKİNCİ kez dondurulabilir.
    // Somut yol — sevk geri alma (storno): sevk irsaliyesi v1 VOIDED'e çekilir,
    // sevkiyat PLANNED'a döner, mal düzeltilip yeniden sevk edilir ve o an ikinci
    // freeze koşar. Sabit `1` ile bu çağrı `docType_sourceId_version` unique'ine
    // çarpıp 500 verirdi — hem de tam sevk anında, tx'i geri sararak.
    // İlk dondurmada davranış BİREBİR aynı (kayıt yok → max null → 1).
    const prev = await tx.printedDocument.findFirst({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await tx.printedDocument.create({
      data: {
        docType,
        sourceId,
        version: (prev?.version ?? 0) + 1,
        status: PrintedDocStatus.ACTIVE,
        documentNo: built.documentNo,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        printedById: userId ?? null,
        ...(reissueReason ? { reissueReason } : {}),
      },
    });
  }

  /**
   * Güncel belgeyi getirir = en yüksek versiyon (ACTIVE ya da VOIDED).
   * Hiç belge yoksa lazy-init dener (eski kayıtların geriye dönük dondurulması);
   * kaynak uygun değilse (örn. Shipment hâlâ hazırlıkta) data:null döner —
   * client TASLAK modunda canlı render eder.
   */
  async getCurrent(
    docType: PrintedDocType,
    sourceId: string,
    // Yalnız istemciye dönen çağrıda hesapla — getHtml'in iç çağrısı bunu geçmez
    // (fazladan envelope kurulmasın). templateStale = donmuş görünüm ≠ güncel şablon.
    opts?: { computeTemplateStale?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const existing = await prisma.printedDocument.findFirst({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
    });
    if (existing) {
      if (opts?.computeTemplateStale) {
        const templateStale = await isTemplateStale(
          prisma,
          docType,
          sourceId,
          existing.snapshot as unknown as PrintedDocSnapshot,
        );
        return { success: true, data: { ...existing, templateStale } };
      }
      return { success: true, data: existing };
    }

    const entry = requireBuilder(docType);
    const built = await (entry.lazyInit ?? entry.fresh)(prisma, sourceId);
    if (!built) return { success: true, data: null };

    const snapshot = await buildSnapshotEnvelope(prisma, docType, built.doc, sourceId);
    try {
      const created = await prisma.printedDocument.create({
        data: {
          docType,
          sourceId,
          version: 1,
          status: built.voidInfo ? PrintedDocStatus.VOIDED : PrintedDocStatus.ACTIVE,
          documentNo: built.documentNo,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          reconstructed: true,
          ...(built.voidInfo
            ? { voidedAt: built.voidInfo.at, voidReason: built.voidInfo.reason }
            : {}),
        },
      });
      await AuditService.log({
        userId: undefined,
        action: "CREATE",
        tableName: "PRINTED_DOCUMENT",
        recordId: created.id,
        newData: { docType, sourceId, documentNo: built.documentNo, event: "LAZY_RECONSTRUCT" },
      });
      // Geriye-dönük kayıt güncel veriden kuruldu → şablonu tanımgereği güncel (stale=false).
      return {
        success: true,
        data: opts?.computeTemplateStale ? { ...created, templateStale: false } : created,
      };
    } catch (err) {
      // Eşzamanlı iki istek aynı anda lazy-init denerse @@unique(docType,sourceId,version)
      // ikincisini P2002 ile düşürür — kazananın yazdığını oku.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.printedDocument.findFirst({
          where: { docType, sourceId },
          orderBy: { version: "desc" },
        });
        return {
          success: true,
          data:
            opts?.computeTemplateStale && winner ? { ...winner, templateStale: false } : winner,
        };
      }
      throw err;
    }
  }

  /**
   * Baskı-hazır HTML — güncel belgeyi alır, docType'a kayıtlı renderHtml ile
   * tek-kaynak HTML üretir. data:null → kaynak TASLAK (henüz donmuş belge yok).
   * allowDraft + builder'da buildPreview varsa, donmuş belge yoksa canlı veriden
   * TASLAK filigranlı HTML üretilir (kaydedilmez) — sevk öncesi önizleme.
   */
  async getHtml(
    docType: PrintedDocType,
    sourceId: string,
    version?: number,
    opts?: {
      allowDraft?: boolean;
      useCurrentConfig?: boolean;
      /** Basan kullanıcı (damga için) — controller req.user'dan geçirir. */
      printedBy?: string | null;
      /** Tek seferlik baskı notu — persist edilmez, yalnız bu render'a girer. */
      printNote?: string | null;
      /**
       * Tek seferlik "satır notlarını bu baskıda göster" (?rowNotes=1). Kalıcı kolon
       * ayarını EZER (OR); persist EDİLMEZ — ne ayara ne snapshot'a yazılır, yeni
       * belge versiyonu doğurmaz.
       */
      forceRowNotes?: boolean;
      /**
       * Tek seferlik LİSTE seçimi (?sections=) — "sadece çuval listesi bas".
       * Kalıcı bölüm ayarını EZER, persist EDİLMEZ. Belge tipi tanımıyorsa
       * renderer bunu sessizce yok sayar.
       */
      listSections?: string[];
      /** Üç listeyi aynı sayfada akıt (?merge=1). Varsayılan: ayrı sayfalar. */
      mergeSections?: boolean;
      /**
       * TEK SEFERLİK kâğıt boyu (?pageSize=A4|A5). Kalıcı ayarı VE donmuş
       * snapshot'ın kendi boyunu EZER; hiçbir yere yazılmaz, yeni versiyon
       * doğurmaz — `forceRowNotes`/`listSections` ile aynı sözleşme.
       */
      pageSize?: "A4" | "A5";
    },
  ): Promise<ApiResponse<{ html: string } | null>> {
    const entry = requireBuilder(docType);
    if (!entry.renderHtml) {
      throw AppError.badRequest(
        `Bu belge tipi için HTML çıktısı tanımlı değil: ${docType}`,
      );
    }

    // Kayıtlı not (annotation) tanımlıysa ephemeral ?printNote='ı EZER — donmuş
    // çekirdeğe girmeden canlı çözülür (tekrar baskıda da çıkar). Yoksa ephemeral.
    const liveNote = entry.resolveLiveNote
      ? await entry.resolveLiveNote(prisma, sourceId)
      : (opts?.printNote ?? null);

    // Satır-bazlı notlar (annotation) — HER baskıda çözülür. Görünürlük kararı
    // renderer'da (kalıcı kolon ayarı VEYA forceRowNotes); bu katman config okumaz.
    const rowNotes = entry.resolveLiveRowNotes
      ? await entry.resolveLiveRowNotes(prisma, sourceId)
      : undefined;
    const noteMeta = {
      rowNotes,
      forceRowNotes: opts?.forceRowNotes ?? false,
      listSections: opts?.listSections,
      mergeSections: opts?.mergeSections ?? false,
    };

    /**
     * TEK SEFERLİK kâğıt boyu ezmesi — yalnız BU render'ın zarfını değiştirir.
     *
     * ⚠️ Kopya üretir, snapshot'ı YERİNDE DEĞİŞTİRMEZ: `rec.snapshot` çağrı
     * zincirinde başka yerlere de gidiyor ve mutasyon, "hiçbir yere yazılmaz"
     * sözünü sessizce bozacak ilk yol olurdu.
     *
     * ⚠️ `style`in DİĞER alanları KORUNUR (yayılarak yazılır). Tüm `style`i
     * `{ pageSize }` ile değiştirmek, belgenin kayıtlı kenar boşluğunu ve punto
     * ölçeğini de sıfırlardı — yani "A5 seç" demek belgenin yerleşimini de
     * bozardı. `resolveDocStyle` kısmi config'i varsayılanlarla çözer.
     */
    const withPageSize = (s: PrintedDocSnapshot): PrintedDocSnapshot =>
      opts?.pageSize
        ? {
            ...s,
            docConfigOverride: {
              ...(s.docConfigOverride ?? {}),
              style: { ...(s.docConfigOverride?.style ?? {}), pageSize: opts.pageSize },
            },
          }
        : s;

    // version verilirse o versiyonun HTML'i (Electron versiyon çubuğu); yoksa güncel.
    const res =
      version != null
        ? await this.getVersion(docType, sourceId, version)
        : await this.getCurrent(docType, sourceId);
    const rec = res.data as {
      snapshot: unknown;
      status: PrintedDocStatus;
      voidReason: string | null;
      documentNo: string;
      version: number;
    } | null;

    if (rec) {
      let snapshot = rec.snapshot as PrintedDocSnapshot;
      // "Güncel şablonla bas" — belge İÇERİĞİ donuk kalır, yalnız görünüm katmanı
      // (şablon override + firma/künye) canlı ayardan yeniden çözülür. Yeni versiyon
      // ÜRETMEZ, snapshot'a yazmaz; sadece bu render için geçici zarf kurulur.
      if (opts?.useCurrentConfig) {
        const fresh = await buildSnapshotEnvelope(prisma, docType, snapshot.doc, sourceId);
        snapshot = { ...fresh, frozenAt: snapshot.frozenAt };
      }
      // Kâğıt boyu ezmesi EN SONDA: "güncel şablonla bas" taze config getirse
      // bile operatörün bu baskı için seçtiği boy kazanmalı.
      snapshot = withPageSize(snapshot);
      const extras = await buildRenderExtras(snapshot, {
        documentNo: rec.documentNo,
        version: rec.version,
        printedBy: opts?.printedBy,
        printNote: liveNote,
      });
      const html = entry.renderHtml(snapshot, {
        status: rec.status,
        voidReason: rec.voidReason,
        ...extras,
        ...noteMeta,
      });
      return { success: true, data: { html } };
    }

    // Donmuş belge yok → istenmişse canlı TASLAK önizlemesi (kaydedilmez).
    if (opts?.allowDraft && version == null && entry.buildPreview) {
      const built = await entry.buildPreview(prisma, sourceId);
      if (built) {
        // TASLAK yolunda da geçerli — sevk öncesi çeki önizlemesi/baskısı da
        // aynı yazıcıya gidiyor; ezmeyi yalnız donmuş dala koymak "taslakta
        // A5 seçemiyorum" gibi açıklanamaz bir asimetri üretirdi.
        const snapshot = withPageSize(
          await buildSnapshotEnvelope(prisma, docType, built.doc, sourceId),
        );
        const extras = await buildRenderExtras(snapshot, {
          documentNo: built.documentNo,
          printedBy: opts?.printedBy,
          printNote: liveNote,
        });
        const html = entry.renderHtml(snapshot, { draft: true, ...extras, ...noteMeta });
        return { success: true, data: { html } };
      }
    }
    return { success: true, data: null };
  }

  /**
   * TASLAK HTML — kaynağı (dispatch vb.) OLMAYAN, çağıranın hazır kurduğu bir
   * `doc` payload'ından, donmadan, baskı-hazır TASLAK HTML üretir. Snapshot zarfı
   * (firma/antet/docConfig) + kayıtlı `renderHtml` (tek-kaynak format) yeniden
   * kullanılır → TASLAK filigranıyla döner. Hiçbir şey persist edilmez.
   * (Erken fason çeki taslağı gibi, dispatch henüz yokken çeki önizlemesi için.)
   */
  async renderDraftHtml(
    docType: PrintedDocType,
    doc: Record<string, unknown>,
  ): Promise<string> {
    const entry = requireBuilder(docType);
    if (!entry.renderHtml) {
      throw AppError.badRequest(
        `Bu belge tipi için HTML çıktısı tanımlı değil: ${docType}`,
      );
    }
    const snapshot = await buildSnapshotEnvelope(prisma, docType, doc);
    const extras = await buildRenderExtras(snapshot, {});
    return entry.renderHtml(snapshot, { draft: true, ...extras });
  }

  /**
   * ÖRNEK HTML — "Belge Şablonları" panelindeki canlı önizleme. Donmuş belge YOK:
   * sabit örnek `doc` (SAMPLE_PRINTED_DOCS) + admin'in DÜZENLEDİĞİ taslak config
   * override + güncel firma/künye ile gerçek renderHtml çağrılır → önizleme baskıyla
   * birebir aynı format. TASLAK filigranıyla döner; hiçbir şey persist edilmez.
   */
  async renderSampleHtml(
    docType: PrintedDocType,
    configOverride: DocumentConfig | null,
  ): Promise<string> {
    const entry = requireBuilder(docType);
    if (!entry.renderHtml) {
      throw AppError.badRequest(`Bu belge tipi için HTML çıktısı tanımlı değil: ${docType}`);
    }
    const doc = SAMPLE_PRINTED_DOCS[docType];
    if (!doc) {
      throw AppError.badRequest(`Bu belge tipi için örnek veri yok: ${docType}`);
    }
    const [companyName, letterhead, logo] = [
      await readCompanyName(prisma),
      await readCompanyLetterhead(prisma),
      await readDocumentsLogo(prisma),
    ];
    const snapshot: PrintedDocSnapshot = {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      company: { name: companyName, letterhead, logoHash: logo.current },
      docConfigOverride: configOverride,
      doc,
    };
    const extras = await buildRenderExtras(snapshot, {});
    return entry.renderHtml(snapshot, { draft: true, ...extras });
  }

  /**
   * REISSUE — gerekçeli yeni versiyon. Aktif belge SUPERSEDED'e çekilir,
   * güncel veriden vN+1 ACTIVE dondurulur. VOIDED belge revize edilemez
   * (kaynak iptal — düzeltme değil yeni sevk gerekir).
   */
  async reissue(
    docType: PrintedDocType,
    sourceId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) {
      throw AppError.badRequest("Revizyon gerekçesi zorunlu (en az 3 karakter)");
    }

    const latest = await prisma.printedDocument.findFirst({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, status: true },
    });
    if (!latest) {
      throw AppError.notFound("Revize edilecek belge yok — belge henüz oluşmamış");
    }
    if (latest.status === PrintedDocStatus.VOIDED) {
      throw AppError.conflict("İptal edilmiş belge revize edilemez");
    }

    const built = await requireBuilder(docType).fresh(prisma, sourceId);
    if (!built) {
      throw AppError.conflict("Kaynak kayıt belge üretimine uygun durumda değil");
    }
    const snapshot = await buildSnapshotEnvelope(prisma, docType, built.doc, sourceId);

    const created = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: gözlenen versiyonu koşullu SUPERSEDED'e çek — eşzamanlı
      // 2. revize count===0 → 409 (çift vN+1 yarışını @@unique zaten keser,
      // claim daha temiz mesaj verir).
      const claim = await tx.printedDocument.updateMany({
        where: { id: latest.id, status: PrintedDocStatus.ACTIVE },
        data: { status: PrintedDocStatus.SUPERSEDED, supersededAt: new Date() },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Belge durumu değişti — yenileyip tekrar deneyin");
      }
      return tx.printedDocument.create({
        data: {
          docType,
          sourceId,
          version: latest.version + 1,
          status: PrintedDocStatus.ACTIVE,
          documentNo: built.documentNo,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          reissueReason: trimmed,
          printedById: userId ?? null,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "PRINTED_DOCUMENT",
      recordId: created.id,
      newData: {
        docType,
        sourceId,
        documentNo: created.documentNo,
        version: created.version,
        event: "REISSUE",
        reason: trimmed,
      },
    });

    return {
      success: true,
      data: created,
      message: `Belge revize edildi: ${created.documentNo} (Rev.${created.version})`,
    };
  }

  /**
   * VOID — kaynak iptal edildiğinde ACTIVE belgeyi VOIDED'e çeker. Domain
   * servisin iptal transaction'ı içinden çağrılır. SUPERSEDED versiyonlara
   * dokunulmaz (tarihsel kayıt). Belge yoksa sessiz no-op (TASLAK aşamasında iptal).
   */
  async voidForSource(
    tx: Prisma.TransactionClient,
    docType: PrintedDocType,
    sourceId: string,
    reason: string | null
  ): Promise<number> {
    const res = await tx.printedDocument.updateMany({
      where: { docType, sourceId, status: PrintedDocStatus.ACTIVE },
      data: { status: PrintedDocStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
    });
    return res.count;
  }

  /**
   * REVİZE (tx içi) — kaynağın İÇERİĞİ değiştiğinde belgeyi yeni versiyonla tazeler:
   * mevcut ACTIVE → SUPERSEDED, güncel veriden v+1 ACTIVE doğar.
   *
   * Public `reissue`den farkı: kendi transaction'ını AÇMAZ, çağıranınkine katılır —
   * yani kaynak mutasyonu ile belge revizyonu ya birlikte olur ya hiç olmaz. Somut
   * kullanım: ÇOK KALEMLİ iade belgesinden bir kalemin iptali (kalan kalemler için
   * belge geçerli kalmalı, ama iptal edilen satır artık basılmamalı).
   *
   * Belge hiç doğmamışsa / zaten VOIDED ise sessiz no-op döner (`false`) — iptal
   * edilmiş belge revize edilmez (public `reissue` ile aynı kural).
   */
  async reissueForSourceTx(
    tx: Prisma.TransactionClient,
    docType: PrintedDocType,
    sourceId: string,
    reason: string,
    userId?: string,
  ): Promise<boolean> {
    const latest = await tx.printedDocument.findFirst({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
      select: { id: true, status: true },
    });
    if (!latest || latest.status === PrintedDocStatus.VOIDED) return false;
    // Atomik claim — eşzamanlı ikinci revize count===0 görür (public reissue ile aynı).
    const claim = await tx.printedDocument.updateMany({
      where: { id: latest.id, status: PrintedDocStatus.ACTIVE },
      data: { status: PrintedDocStatus.SUPERSEDED, supersededAt: new Date() },
    });
    if (claim.count === 0) throw AppError.conflict("Belge durumu değişti — yenileyip tekrar deneyin");
    await this.freezeForSource(tx, docType, sourceId, userId, reason);
    return true;
  }

  /** Versiyon listesi — snapshot JSON'u ÇEKMEDEN (perf kuralı 13). */
  async listVersions(docType: PrintedDocType, sourceId: string): Promise<ApiResponse<unknown>> {
    const versions = await prisma.printedDocument.findMany({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        status: true,
        documentNo: true,
        reissueReason: true,
        supersededAt: true,
        voidedAt: true,
        voidReason: true,
        reconstructed: true,
        createdAt: true,
        printedBy: { select: { id: true, fullName: true } },
      },
    });
    return { success: true, data: versions };
  }

  /** Tek versiyonu snapshot'ıyla getirir (eski versiyonu görüntüleme/baskı). */
  async getVersion(
    docType: PrintedDocType,
    sourceId: string,
    version: number
  ): Promise<ApiResponse<unknown>> {
    const doc = await prisma.printedDocument.findUnique({
      where: { docType_sourceId_version: { docType, sourceId, version } },
    });
    if (!doc) throw AppError.notFound("Belge versiyonu bulunamadı");
    return { success: true, data: doc };
  }
}

export const printedDocumentService = new PrintedDocumentService();
