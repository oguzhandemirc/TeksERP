// =============================================================================
// TeksERP - SystemLog Read Service
// =============================================================================
// SystemLog en hızlı büyüyen tablodur. Bu servisin tüm sorgu yolları:
//   - mevcut @@index([createdAt]) üzerinden çalışır (ORDER BY createdAt DESC)
//   - hiç COUNT(*) almaz (cursor pagination → hasMore boolean)
//   - liste view'da Json payload (oldData/newData) seçmez
//   - limit hard cap 100
// Detay (oldData/newData) sadece findById ile çekilir.
// =============================================================================

import prisma from "../lib/prisma";
import { resolveChangeValues, attachLabels } from "./helpers/audit-value-resolver";
import { Prisma, SystemLogCategory } from "@prisma/client";
import { decodeCursor, cursorWhere, buildNextCursor } from "../utils/cursor";
import { ACTOR_SELECT } from "./helpers/system-account.helper";
import { LIST_SELECT, RECORD_HISTORY_SELECT, REQUEST_ID_RE, parseCategories, readRequestId, dropdownCache } from "./helpers/system-log-select.helper";
import { getTracesByIds, listRejectedTraces } from "./request-trace.service";
import { findRecords } from "./helpers/audit-record-resolver.helper";
import { type Gun, grupSirasi, imlecOku, imlecYaz, islemKosullari } from "./helpers/system-log-islem.helper";
import {
  type RawOperationRow, anlatiEkle, gunluParams, islemAyrintisi, islemFiltresi, islemleriKur,
  islemdeReddedilenGorunur, recordSearchResult, rejectedTracePage, tekAnlati,
} from "./helpers/system-log-islem-kur.helper";

export interface SystemLogListParams {
  cursor?: string;
  limit?: number;
  userId?: string;
  tableName?: string;
  /**
   * TEK KAYDIN geçmişi (Faz B1, 2026-08-19) — "bu iş emrini kim ne zaman
   * değiştirmiş" sorusu bugüne kadar API'den SORULAMIYORDU; oysa DB'de
   * `@@index([tableName, recordId])` zaten vardı. `tableName` ile BİRLİKTE
   * verilmelidir, yoksa index'in ilk kolonu boş kalır ve sorgu seq scan'e döner.
   */
  recordId?: string;
  // "DOMAIN" — CUD audit (Activity Page). "AUTH" / "SYSTEM" — Sistem Kayıtları sayfası.
  // Birden fazla kategori için virgülle ayrılmış string kabul edilir.
  category?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * TEK İSTEĞİN tüm satırları (2026-08-19) — "bu üç değişiklik aynı kaydetme
   * tuşundan mı çıktı?" sorusunun cevabı. Değer UUID'dir ve `readRequestId`
   * ile elenir: kolon `@db.Uuid` olduğu için ham metin P2023 → 500 üretirdi.
   */
  requestId?: string;
  /** B4 "Reddedilenler" süzgeci: "1" = yalnız trace status ≥ 400 (yalnız işlem görünümü). */
  reddedilen?: "0" | "1";
  /** Fabrika günü kısayolu (B2): verilirse `dateFrom/dateTo`yu ezer. */
  gun?: Gun;
}



export class SystemLogService {
  static async list(rawParams: SystemLogListParams) {
    const params = gunluParams(rawParams);
    const rawLimit = params.limit ?? 50;
    const limit = Math.min(Math.max(1, rawLimit), 100);

    const where: Prisma.SystemLogWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.tableName) where.tableName = params.tableName;
    if (params.recordId) where.recordId = params.recordId;
    if (params.action) where.action = params.action;
    const reqId = readRequestId(params.requestId);
    if (reqId) where.requestId = reqId;
    const cats = parseCategories(params.category);
    if (cats) where.category = cats.length === 1 ? cats[0] : { in: cats };

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) {
        const d = new Date(params.dateFrom);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (params.dateTo) {
        const d = new Date(params.dateTo);
        if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const cursor = decodeCursor(params.cursor);
    const finalWhere = cursor ? { AND: [where, cursorWhere(cursor)] } : where;

    const items = await prisma.systemLog.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      // Kayıt-bazlı geçmişte alan-bazlı değişiklik + cihaz da döner (yukarıdaki
      // nota bak); genel listede dönmez.
      select: params.recordId ? RECORD_HISTORY_SELECT : LIST_SELECT,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? buildNextCursor(last) : null;

    // Kayıt geçmişinde UUID değerleri ada çevrilir — sayfanın TÜMÜ tek turda
    // toplanır (tablo başına tek sorgu), satır başına lookup DEĞİL.
    // ⚠️ `page`i dar bir tipe CAST ETME — spread o tipi taşır ve dönen satırdan
    // `tableName`/`id` gibi alanlar sessizce düşer (ilk yazımda oldu, tip
    // kontrolü yakaladı). Satır tipi olduğu gibi korunur, alan alan okunur.
    const data = params.recordId
      ? await (async () => {
          const labels = await resolveChangeValues(
            page.map((r) => (r as { changes?: unknown }).changes as never),
          );
          return page.map((r) => ({
            ...r,
            changes: attachLabels((r as { changes?: unknown }).changes, labels),
          }));
        })()
      : page;
    // B2 anlatı: diff + olay işareti sayfa başına TEK sorgu (listede JSON gövde çekilmez).
    const ekler = data.length
      ? await prisma.$queryRaw<Array<{ id: string; changes: unknown; event: string | null }>>`
          SELECT "id"::text AS id, "changes", "newData"->>'event' AS event FROM system_logs
          WHERE "id" = ANY(${data.map((r) => r.id)}::uuid[])`
      : [];

    return {
      success: true,
      data: await anlatiEkle(data, ekler),
      pagination: { nextCursor, hasMore, limit },
    };
  }

  static async findById(id: string) {
    const record = await prisma.systemLog.findUnique({
      where: { id },
      include: { user: { select: ACTOR_SELECT } },
    });
    if (!record) return { success: false, data: null, message: "Kayıt bulunamadı" };
    const labels = await resolveChangeValues([record.changes as never]);
    return {
      success: true,
      data: { ...record, changes: attachLabels(record.changes, labels), anlati: await tekAnlati(record) },
    };
  }

  // ---------------------------------------------------------------------------
  // Arşiv okuma — `system_log_archives` tablosunu sorgular.
  // Arşiv UI denetim/lookback amaçlı; yüksek hacim beklenmez ama yine de
  // cursor pagination + JSON-suz LIST_SELECT + filter desteğiyle güvende.
  // SystemLogArchive'da user FK olmadığı için user join'i ayrı: userId ile
  // tekrar lookup yapıyoruz, küçük N (sayfa boyutu) olduğu için sorun değil.
  // ---------------------------------------------------------------------------

  static async listArchive(rawParams: SystemLogListParams) {
    const params = gunluParams(rawParams);
    const rawLimit = params.limit ?? 50;
    const limit = Math.min(Math.max(1, rawLimit), 100);

    const where: Prisma.SystemLogArchiveWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.tableName) where.tableName = params.tableName;
    if (params.recordId) where.recordId = params.recordId;
    if (params.action) where.action = params.action;
    const reqId = readRequestId(params.requestId);
    if (reqId) where.requestId = reqId;
    const cats = parseCategories(params.category);
    if (cats) where.category = cats.length === 1 ? cats[0] : { in: cats };

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) {
        const d = new Date(params.dateFrom);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (params.dateTo) {
        const d = new Date(params.dateTo);
        if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const cursor = decodeCursor(params.cursor);
    const finalWhere = cursor ? { AND: [where, cursorWhere(cursor)] } : where;

    const items = await prisma.systemLogArchive.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        category: true,
        action: true,
        tableName: true,
        recordId: true,
        ipAddress: true,
        userId: true,
        createdAt: true,
        // Arşiv paritesi BİLİNÇLİ: `deviceId`/`changes` bir kez unutulmuştu ve
        // özellik 6 ay sonra sessizce ölecekti. Gruplama arşivde de çalışır.
        requestId: true,
      },
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    const userIds = [
      ...new Set(data.map((d) => d.userId).filter((id): id is string => !!id)),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: ACTOR_SELECT,
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // ⚠️ Arşiv satırı DA KALIR (karar #8 — tam iz). 2026-09-04'ten beri kimlik
    // de maskelenmez: aktör gerçek adıyla görünür.
    const enriched = data.map((d) => ({
        id: d.id,
        category: d.category,
        action: d.action,
        tableName: d.tableName,
        recordId: d.recordId,
        ipAddress: d.ipAddress,
        requestId: d.requestId,
        createdAt: d.createdAt,
        user: d.userId ? (userMap.get(d.userId) ?? null) : null,
    }));

    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? buildNextCursor(last) : null;

    const ekler = enriched.length
      ? await prisma.$queryRaw<Array<{ id: string; changes: unknown; event: string | null }>>`
          SELECT "id"::text AS id, "changes", "newData"->>'event' AS event FROM system_log_archives
          WHERE "id" = ANY(${enriched.map((r) => r.id)}::uuid[])`
      : [];

    return {
      success: true,
      data: await anlatiEkle(enriched, ekler),
      pagination: { nextCursor, hasMore, limit },
    };
  }

  static async findArchiveById(id: string) {
    const record = await prisma.systemLogArchive.findUnique({ where: { id } });
    if (!record) return { success: false, data: null, message: "Kayıt bulunamadı" };
    const user = record.userId
      ? await prisma.user.findUnique({
          where: { id: record.userId },
          select: ACTOR_SELECT,
        })
      : null;
    const labels = await resolveChangeValues([record.changes as never]);
    return {
      success: true,
      data: { ...record, user, changes: attachLabels(record.changes, labels), anlati: await tekAnlati({ ...record, user }) },
    };
  }

  // ─── İŞLEM GÖRÜNÜMÜ (izlenebilirlik B2) — tek "Kaydet" = tek iş eylemi ─────
  // YALNIZ GÖRÜNTÜ (audit-okuma-beyan: DENETIM_EKRANI). Gruplama her dönemde AYNI:
  // COALESCE(requestId, id); trace yalnız başlık ekler, reddedilen istek trace'ten gelir.
  // Tarama sınırlı: son K satır (createdAt dizini) gruplanır; sınırı aşan grubun önceki
  // sayfada görünmüş parçası gerçek tepe zamanıyla ayıklanır.
  static async listIslemler(params: SystemLogListParams) {
    const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
    const cats = parseCategories(params.category);
    const f = islemFiltresi(params, cats);
    if (params.reddedilen === "1") return SystemLogService.listReddedilenIslemler(params, cats, f, limit);
    const kos = islemKosullari(f);
    const c = imlecOku(params.cursor);
    const K = limit * 40;
    const ust = c ? Prisma.sql`AND sl."createdAt" <= ${c.at}` : Prisma.empty;
    const having = c ? Prisma.sql`HAVING (max(son."createdAt"), COALESCE(son."requestId", son."id")::text) < (${c.at}::timestamptz, ${c.key})` : Prisma.empty;
    const gruplar = await prisma.$queryRaw<Array<{ key: string; istekli: boolean; at: Date; taranan: number }>>`
      WITH son AS (SELECT sl."id", sl."requestId", sl."createdAt" FROM system_logs sl
                   WHERE ${kos} ${ust} ORDER BY sl."createdAt" DESC, sl."id" DESC LIMIT ${K})
      SELECT COALESCE(son."requestId", son."id")::text AS key, (son."requestId" IS NOT NULL) AS istekli,
             max(son."createdAt") AS at, (SELECT count(*)::int FROM son) AS taranan
      FROM son GROUP BY 1, 2 ${having} ORDER BY at DESC, key DESC LIMIT ${limit + 1}`;
    // Önceki sayfada görünmüş grubun parçası: gerçek tepe zamanı imlecin üstündeyse atılır.
    const istekliKeys = gruplar.filter((g) => g.istekli).map((g) => g.key);
    const tepeler = c && istekliKeys.length
      ? await prisma.$queryRaw<Array<{ key: string; at: Date }>>`
          SELECT sl."requestId"::text AS key, max(sl."createdAt") AS at FROM system_logs sl
          WHERE ${kos} AND sl."requestId" = ANY(${istekliKeys}::uuid[]) GROUP BY 1`
      : [];
    const tepe = new Map(tepeler.map((t) => [t.key, t.at]));
    const eligible = gruplar.filter((g) => !c || !g.istekli || grupSirasi({ at: tepe.get(g.key) ?? g.at, key: g.key }, c) > 0);
    const reddedilen = islemdeReddedilenGorunur(params, cats)
      ? await listRejectedTraces({ userId: params.userId, from: f.from, to: f.to, before: c ? { at: c.at, id: c.key } : undefined }, limit + 1)
      : [];
    const sirali = [
      ...eligible.map((g) => ({ at: g.at, key: g.key, istekli: g.istekli })),
      ...reddedilen.map((t) => ({ at: t.createdAt, key: t.id, istekli: true })),
    ].sort(grupSirasi);
    const hasMore = sirali.length > limit || (gruplar[0]?.taranan ?? 0) >= K;
    const page = sirali.slice(0, limit);
    const istekIds = page.filter((g) => g.istekli).map((g) => g.key);
    const tekIds = page.filter((g) => !g.istekli).map((g) => g.key);
    const data = await islemleriKur(page, await SystemLogService.islemSatirlari(istekIds, tekIds), await getTracesByIds(istekIds));
    const last = page[page.length - 1];
    // `reddedilenSuzgeci`: panel bu alanı görmezse (eski backend) "Reddedilenler" çipini gizler.
    return { success: true, data, reddedilenSuzgeci: true, pagination: { nextCursor: hasMore && last ? imlecYaz(last) : null, hasMore, limit } };
  }

  /** "Reddedilenler" süzgeci (B4) — sayfa trace'ten, satırlar aynı sorgudan. */
  private static async listReddedilenIslemler(params: SystemLogListParams, cats: SystemLogCategory[] | undefined, f: ReturnType<typeof islemFiltresi>, limit: number) {
    const { izler, hasMore, page } = await rejectedTracePage(params, cats, f, limit);
    const data = await islemleriKur(page, await SystemLogService.islemSatirlari(page.map((g) => g.key), []), izler);
    return { success: true, data, reddedilenSuzgeci: true, pagination: { nextCursor: hasMore ? imlecYaz(page[page.length - 1]!) : null, hasMore, limit } };
  }

  /** Sayfadaki grupların audit satırları (istek kimliğiyle ya da tek satır kimliğiyle) — tek sorgu. */
  private static async islemSatirlari(istekIds: string[], tekIds: string[]): Promise<RawOperationRow[]> {
    if (istekIds.length === 0 && tekIds.length === 0) return [];
    return prisma.$queryRaw<RawOperationRow[]>`
      SELECT sl."id"::text AS id, sl."tableName", sl."action", sl."recordId", sl."userId"::text AS "userId",
             sl."requestId"::text AS "requestId", sl."createdAt", sl."changes", sl."newData"->>'event' AS event
      FROM system_logs sl WHERE sl."requestId" = ANY(${istekIds}::uuid[]) OR sl."id" = ANY(${tekIds}::uuid[])
      ORDER BY sl."createdAt" ASC, sl."id" ASC LIMIT 2000`;
  }

  /** Tek işlem: trace başlığı + cihaz ADI + etkilenen kayıtlar + alan farkları + ham. */
  static async findIslem(requestId: string) {
    if (!REQUEST_ID_RE.test(requestId)) return { success: false as const, data: null, message: "İşlem bulunamadı" };
    const rows = await prisma.systemLog.findMany({
      where: { requestId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      include: { user: { select: ACTOR_SELECT } },
    });
    return islemAyrintisi(requestId, rows);
  }

  /** Kayıt numarasıyla arama (SP-…, CV…, CL…, barkod): kaydın satırları + aynı istekteki kardeşler. */
  static async listByRecordQuery(q: string, limitRaw?: number) {
    const limit = Math.min(Math.max(1, limitRaw ?? 50), 100);
    const records = await findRecords(q);
    if (records.length === 0) return { success: true, data: [], kayitlar: records, warnings: ["Bu numarada kayıt bulunamadı"] };
    const dogrudan = await prisma.systemLog.findMany({
      where: { OR: records.map((k) => ({ tableName: k.tableName, recordId: k.recordId })) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: RECORD_HISTORY_SELECT,
    });
    const reqIds = [...new Set(dogrudan.map((r) => r.requestId).filter((x): x is string => !!x))];
    const kardes = reqIds.length
      ? await prisma.systemLog.findMany({
          where: { requestId: { in: reqIds } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 500,
          select: RECORD_HISTORY_SELECT,
        })
      : [];
    return recordSearchResult(records, dogrudan, kardes);
  }

  /**
   * Activity Page filter dropdown'ı — yalnız DOMAIN kategorisinde log'u olan
   * kullanıcılar. AUTH/SYSTEM event kullanıcıları Sistem Kayıtları sayfasında
   * kullanılır ve orada hardcoded değil, dinamik liste gerektirmez.
   */
  static async listActiveUsers() {
    return dropdownCache.get("users", async () => {
      // HAM SQL, ÇÜNKÜ PRISMA `distinct`'İ SQL'E İNDİRMİYOR (2026-09-05 perf turu).
      // Yakalanan SQL'de ne DISTINCT ne LIMIT vardı: 14.067 satır Node'a çekilip
      // bellekte tekilleştiriliyordu, ardından 61 id ile İKİNCİ bir sorgu atıyordu.
      // Ölçüm — ÖNCE: 2 sorgu, 8,75 ms / 2.470 buffer (Seq Scan + 14.067 satırlık
      // quicksort) + 1,66 ms, telde 14.128 satır. SONRA: 1 sorgu, 7,10 ms /
      // 2.472 buffer (HashAggregate SQL'de), telde 61 satır.
      // ⚠️ Bu DROPDOWN'dır (olay listesi DEĞİL) → satıcı hesabı burada SÜZÜLÜR.
      // ⚠️ Sıralama BİLİNÇLİ OLARAK YOK: Prisma yolu da sıra garantisi vermiyordu
      // (ORDER BY system_logs.id = rastgele UUID); ORDER BY eklemek görünen sonucu
      // değiştirirdi, bu tur davranışa dokunmuyor.
      return prisma.$queryRaw<Array<{ id: string; username: string; fullName: string }>>`
        SELECT u."id", u."username", u."fullName"
        FROM (
          SELECT DISTINCT sl."userId" AS uid
          FROM "system_logs" sl
          WHERE sl."category" = 'DOMAIN'::"SystemLogCategory" AND sl."userId" IS NOT NULL
          LIMIT 200
        ) d
        JOIN "users" u ON u."id" = d.uid
      `;
    });
  }

  /** Activity Page filter dropdown'ı — sadece DOMAIN tableName'leri. */
  static async listActiveTables() {
    return dropdownCache.get("tables", async () => {
      // Aynı gerekçe (yukarı bak): `distinct` SQL'e inmiyordu → 49.879 satır
      // Node'a çekiliyordu. Ölçüm — ÖNCE 13,20 ms / 2.467 buffer, telde 49.879
      // satır; SONRA 8,30 ms / 2.467 buffer (HashAggregate), telde 78 satır.
      const rows = await prisma.$queryRaw<Array<{ tableName: string }>>`
        SELECT DISTINCT sl."tableName"
        FROM "system_logs" sl
        WHERE sl."category" = 'DOMAIN'::"SystemLogCategory"
        LIMIT 200
      `;
      return rows.map((r) => r.tableName);
    });
  }
}
