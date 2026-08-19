// =============================================================================
// KAYIT BİLGİSİ — "bunu kim oluşturdu, en son kim değiştirdi?" (2026-08-17)
// =============================================================================
// Saha isteği: sipariş/iş emri gibi önemli kayıtlarda bir ⓘ düğmesi; basınca
// ilk oluşturulma ve son değişiklik anı + kim yaptığı görünsün.
//
// ── BACKENDİ EN AZ YORAN TASARIM ────────────────────────────────────────────
// Üç karar bunun için verildi:
//
//   1. LİSTE VE DETAY PAYLOAD'LARINA HİÇBİR ŞEY EKLENMEDİ. Bilgi yalnız ⓘ'ye
//      BASILINCA çekilir. Tersi (her satıra "son değiştiren" iliştirmek) her
//      liste isteğine bir join daha bindirirdi ve bilgiye yüz satırda bir kez
//      bakılıyor.
//
//   2. TARİHLER SUNUCUDAN İSTENMEZ. `createdAt`/`updatedAt` istemcinin elindeki
//      kayıtta ZATEN var; buradan yalnız KİM sorusunun cevabı döner. Böylece
//      sorgu ikinci bir tabloya (siparişe/iş emrine) hiç gitmez.
//
//   3. İKİ İNDEKSLİ SORGU. `system_logs` üzerinde `@@index([tableName, recordId])`
//      mevcut; ilk CREATE ve son kayıt bu indeksten iki `findFirst` ile okunur.
//
// ⚠️ TABLO ALLOWLIST'İ VE YETKİ ROUTE KATMANINDA (`record-info.routes.ts`):
// yetkilendirme guard'ın işi. Bu servis, çağrıldığı ana kadar doğrulamanın
// yapıldığını varsayar ve YALNIZ route'tan çağrılır.
//
// ── 2026-08-19: ÖNCE KOLON, SONRA AUDIT ────────────────────────────────────
// İlk yazımda bilgi YALNIZ audit'ten okunuyordu ve bu bir KUSURDU: audit 6 ayda
// arşive taşınır (`jobs/archive-scheduler`) → 6 aydan eski kayıtta ⓘ düğmesi
// SESSİZCE boş dönerdi. Fark edilmemişti çünkü sistemdeki en eski kayıt 34
// günlüktü.
//
// Yapısal cevap: künye artık kaydın KENDİ kolonlarında duruyor
// (`createdById`/`updatedById` — docs/design/KAYIT-KUNYESI-TASARIM.md) ve önce
// oradan okunur. Kolonu OLMAYAN tablolarda (iş emri, sevkiyat… 2. faz) audit'e
// düşülür ve o yol artık ARŞİVİ DE tarar.
//
// Yanıt hangi kaynaktan geldiğini SÖYLER (`source`) — arayüz "kolon" ile
// "arşivden bulundu"yu ayırt edebilsin ve hiçbir zaman sessizce yalan söylemesin.
// =============================================================================

import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";

export interface RecordActor {
  at: string;
  userId: string | null;
  userName: string | null;
  action?: string;
}

export interface RecordInfo {
  created: RecordActor | null;
  lastChange: RecordActor | null;
  /** Hiçbir kaynakta bilgi bulunamadı mı. */
  auditEmpty: boolean;
  /**
   * Bilgi NEREDEN geldi:
   *   "column"  — kaydın kendi künye kolonları (kalıcı, arşivden etkilenmez)
   *   "audit"   — sıcak audit tablosu
   *   "archive" — arşivlenmiş audit (kolonu olmayan eski kayıt)
   *   "none"    — bulunamadı
   */
  source: "column" | "audit" | "archive" | "none";
}

/**
 * Künye KOLONU taşıyan tablolar (audit `tableName` → Prisma delegate).
 *
 * ⚠️ Liste `scripts/test_record_provenance.ts` tarafından şemaya karşı
 * doğrulanır — model kolon aldığında buraya da eklenmeli, yoksa bilgi kolonda
 * dururken audit'ten okunmaya devam eder (sessiz gerileme).
 */
const PROVENANCE_TABLES = {
  CUSTOMER: () => prisma.customer,
  ITEM: () => prisma.item,
  ORDER: () => prisma.order,
  COLOR: () => prisma.color,
  STATION: () => prisma.station,
  MACHINE: () => prisma.machine,
  SUBCONTRACTOR: () => prisma.subcontractor,
  QUALITY_GRADE: () => prisma.qualityGrade,
  DEFECT_TYPE: () => prisma.defectType,
  RETURN_REASON: () => prisma.returnReason,
  FABRIC_PROPERTY: () => prisma.fabricProperty,
  PRODUCT_RECIPE: () => prisma.productRecipe,
  ROUTE: () => prisma.route,
  PERIPHERAL_DEVICE: () => prisma.peripheralDevice,
  CUSTOMER_BRANCH: () => prisma.customerBranch,
  LABEL_TEMPLATE: () => prisma.labelTemplate,
  BATCH: () => prisma.batch,
} as const;

function toActor(row: {
  createdAt: Date;
  action?: string;
  userId: string | null;
  user: { fullName: string | null; username: string } | null;
}): RecordActor {
  return {
    at: row.createdAt.toISOString(),
    userId: row.userId,
    // Ad yoksa kullanıcı adına düş — "—" yazmak "kim olduğu bilinmiyor"
    // demektir, oysa biliyoruz.
    userName: row.user?.fullName?.trim() || row.user?.username || null,
    ...(row.action ? { action: row.action } : {}),
  };
}

export class RecordInfoService {
  /**
   * Kaydın ilk oluşturucusu + son değiştireni. İki indeksli `findFirst`.
   *
   * `CREATE` satırı ayrı aranır çünkü en eski satır her zaman CREATE olmayabilir
   * (audit kısmen arşivlenmiş olabilir ya da kayıt migration'la doğmuş olabilir).
   */
  async get(tableName: string, recordId: string): Promise<ApiResponse<RecordInfo>> {
    // ── 1) KOLON YOLU (tercih edilen) ────────────────────────────────────
    const fromColumn = await this.fromColumns(tableName, recordId);
    if (fromColumn) return { success: true, data: fromColumn };

    // ── 2) AUDIT YOLU — kolonu olmayan tablolar (iş emri, sevkiyat…) ─────
    return { success: true, data: await this.fromAudit(tableName, recordId) };
  }

  /**
   * Kaydın kendi künye kolonlarından okur. Kolonu olmayan tabloda `null` döner
   * (çağıran audit'e düşer).
   *
   * ⚠️ Kolon VAR ama İKİSİ DE boşsa da `null` dönülür: backfill eşleşmemiş
   * demektir ve audit'te hâlâ cevap olabilir. Boş künyeyi "cevap" saymak,
   * elimizdeki bilgiyi kullanmadan "bilinmiyor" demek olurdu.
   */
  private async fromColumns(tableName: string, recordId: string): Promise<RecordInfo | null> {
    const get = PROVENANCE_TABLES[tableName as keyof typeof PROVENANCE_TABLES];
    if (!get) return null;

    const userSel = { select: { fullName: true, username: true } } as const;
    const row = await (get() as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
      where: { id: recordId },
      select: {
        createdAt: true, updatedAt: true,
        createdById: true, updatedById: true,
        createdBy: userSel, updatedBy: userSel,
      },
    }) as null | {
      createdAt: Date; updatedAt: Date;
      createdById: string | null; updatedById: string | null;
      createdBy: { fullName: string | null; username: string } | null;
      updatedBy: { fullName: string | null; username: string } | null;
    };
    if (!row) return null;
    if (!row.createdById && !row.updatedById) return null; // backfill tutmamış → audit dene

    const name = (u: { fullName: string | null; username: string } | null): string | null =>
      u?.fullName?.trim() || u?.username || null;

    return {
      created: row.createdById
        ? { at: row.createdAt.toISOString(), userId: row.createdById, userName: name(row.createdBy) }
        : null,
      lastChange: row.updatedById
        ? { at: row.updatedAt.toISOString(), userId: row.updatedById, userName: name(row.updatedBy) }
        : null,
      auditEmpty: false,
      source: "column",
    };
  }

  /**
   * Audit yolu — sıcak tablo, bulunamazsa ARŞİV.
   *
   * ⚠️ Arşiv taraması 2026-08-19'da eklendi. Öncesinde yalnız sıcak tabloya
   * bakılıyordu ve 6 aydan eski kayıtta ⓘ SESSİZCE boş dönüyordu.
   */
  private async fromAudit(tableName: string, recordId: string): Promise<RecordInfo> {
    const sel = {
      createdAt: true, action: true, userId: true,
      user: { select: { fullName: true, username: true } },
    } as const;

    const [createdRow, lastRow] = await Promise.all([
      prisma.systemLog.findFirst({
        where: { tableName, recordId, action: "CREATE" },
        orderBy: { createdAt: "asc" }, select: sel,
      }),
      prisma.systemLog.findFirst({
        where: { tableName, recordId },
        orderBy: { createdAt: "desc" }, select: sel,
      }),
    ]);
    if (createdRow || lastRow) {
      return {
        created: createdRow ? toActor(createdRow) : null,
        lastChange: lastRow ? toActor(lastRow) : null,
        auditEmpty: false,
        source: "audit",
      };
    }

    // Sıcak tabloda yok → ARŞİVE bak. Aynı index (tableName, recordId) orada da var.
    //
    // ⚠️ `SystemLogArchive`'ın `user` İLİŞKİSİ YOKTUR (arşiv satırı kullanıcıya
    // FK ile bağlı değil — kullanıcı silinse bile arşiv durmalı). Bu yüzden ad
    // AYRI bir sorguyla çözülür; sıcak tablonun `select`'ini burada yeniden
    // kullanmak çalışma-zamanında patlar (ölçüldü, 2026-08-19).
    const aSel = { createdAt: true, action: true, userId: true } as const;
    const [aCreated, aLast] = await Promise.all([
      prisma.systemLogArchive.findFirst({
        where: { tableName, recordId, action: "CREATE" },
        orderBy: { createdAt: "asc" }, select: aSel,
      }),
      prisma.systemLogArchive.findFirst({
        where: { tableName, recordId },
        orderBy: { createdAt: "desc" }, select: aSel,
      }),
    ]);
    if (!aCreated && !aLast) {
      return { created: null, lastChange: null, auditEmpty: true, source: "none" };
    }

    // Ad çözümü tek sorguda (iki satır çoğu zaman aynı kullanıcı).
    const ids = [...new Set([aCreated?.userId, aLast?.userId].filter((x): x is string => !!x))];
    const users = ids.length
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, username: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const wrap = (r: typeof aCreated): RecordActor | null =>
      r ? toActor({ ...r, user: r.userId ? byId.get(r.userId) ?? null : null }) : null;

    return {
      created: wrap(aCreated),
      lastChange: wrap(aLast),
      auditEmpty: false,
      source: "archive",
    };
  }
}

export const recordInfoService = new RecordInfoService();
