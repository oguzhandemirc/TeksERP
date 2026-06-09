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
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  readCompanyName,
  readCompanyLetterhead,
  readDocumentsConfig,
  type CompanyLetterhead,
  type DocumentConfig,
} from "./system-setting.service";
import { ApiResponse } from "../types/api.types";

/** Builder'ların aldığı istemci — tx içinden (freeze) veya dışından (reissue/lazy) çalışır. */
export type PrintedDocDb = Prisma.TransactionClient | typeof prisma;
type Db = PrintedDocDb;

/** docType → belge ayar anahtarı (client DOC_DEFS / resolveDocConfig ile aynı key). */
const DOC_CONFIG_KEYS: Record<PrintedDocType, string> = {
  SHIPMENT_DISPATCH: "shipmentDispatch",
  SUBCONTRACTOR_DISPATCH: "fasonSevk",
  KARTELA_DISPATCH: "kartelaCeki",
};

/** Snapshot zarfı — `doc` tip-bazlı payload, geri kalanı ortak meta. */
export interface PrintedDocSnapshot {
  schemaVersion: 1;
  frozenAt: string;
  company: { name: string; letterhead: CompanyLetterhead };
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
  doc: Record<string, unknown>
): Promise<PrintedDocSnapshot> {
  const [companyName, letterhead, documentsConfig] = [
    await readCompanyName(db),
    await readCompanyLetterhead(db),
    await readDocumentsConfig(db),
  ];
  return {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    company: { name: companyName, letterhead },
    docConfigOverride: documentsConfig[DOC_CONFIG_KEYS[docType]] ?? null,
    doc,
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
    userId?: string
  ): Promise<void> {
    const built = await requireBuilder(docType).fresh(tx, sourceId);
    if (!built) {
      throw AppError.internal(`Belge dondurulamadı — kaynak uygun durumda değil: ${docType}/${sourceId}`);
    }
    const snapshot = await buildSnapshotEnvelope(tx, docType, built.doc);
    await tx.printedDocument.create({
      data: {
        docType,
        sourceId,
        version: 1,
        status: PrintedDocStatus.ACTIVE,
        documentNo: built.documentNo,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        printedById: userId ?? null,
      },
    });
  }

  /**
   * Güncel belgeyi getirir = en yüksek versiyon (ACTIVE ya da VOIDED).
   * Hiç belge yoksa lazy-init dener (eski kayıtların geriye dönük dondurulması);
   * kaynak uygun değilse (örn. Shipment hâlâ hazırlıkta) data:null döner —
   * client TASLAK modunda canlı render eder.
   */
  async getCurrent(docType: PrintedDocType, sourceId: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.printedDocument.findFirst({
      where: { docType, sourceId },
      orderBy: { version: "desc" },
    });
    if (existing) return { success: true, data: existing };

    const entry = requireBuilder(docType);
    const built = await (entry.lazyInit ?? entry.fresh)(prisma, sourceId);
    if (!built) return { success: true, data: null };

    const snapshot = await buildSnapshotEnvelope(prisma, docType, built.doc);
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
      return { success: true, data: created };
    } catch (err) {
      // Eşzamanlı iki istek aynı anda lazy-init denerse @@unique(docType,sourceId,version)
      // ikincisini P2002 ile düşürür — kazananın yazdığını oku.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.printedDocument.findFirst({
          where: { docType, sourceId },
          orderBy: { version: "desc" },
        });
        return { success: true, data: winner };
      }
      throw err;
    }
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
    const snapshot = await buildSnapshotEnvelope(prisma, docType, built.doc);

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
