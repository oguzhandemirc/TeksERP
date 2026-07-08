// =============================================================================
// TeksERP - Work Session (Çalışma Oturumu) Service
// =============================================================================
// Ayak izi + donanım/atıf bağlamı: KİM, HANGİ CİHAZLA, HANGİ MAKİNEDE/İSTASYONDA,
// NE ZAMAN. Kurallar:
//  - Bir CİHAZDA tek aktif oturum + bir MAKİNEDE tek aktif oturum. DB seddi iki
//    ŞEMA-DIŞI partial unique (migration 20260702121000); eşzamanlı open yarışının
//    kaybedeni P2002 alır → burada 409'a çevrilir.
//  - stationId HER ZAMAN dolu: makineli açılışta makineden türetilip DONDURULUR
//    (client'tan gelen stationId makineli açılışta yok sayılır).
//  - Makinesi olan istasyonda istasyon-oturumu YASAK (donanım bağlama kuralının aynası).
//  - Devralma warn-then-confirm: makine doluysa önce 409 MACHINE_OCCUPIED; istemci
//    confirmTakeover ile tekrar dener → eski oturum TAKEOVER ile kapanır.
//  - Idle kapatma TEMBEL (work-session.helper.ts) — timer/cron YOK.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { resolveActiveSession, sweepIdleSessions } from "./helpers/work-session.helper";
import { buildPagination } from "../utils/query-parser";
import { matchesPermission } from "../middlewares/rbac.middleware";
import type { WorkSessionEndReason, StationKind } from "@prisma/client";
import type { ApiResponse, PaginatedResponse } from "../types/api.types";

const TABLE = "WORK_SESSION";

/**
 * Oturum açılabilen istasyon türleri — mobil StationKind→ekran registry'sinin
 * backend aynası (RAW_QC→KK1, PROCESS_QC→KK2/Kurşun, TAMBUR→Tambur, SHIPPING→Tartı/Paket).
 */
export const SESSIONABLE_STATION_KINDS = ["RAW_QC", "PROCESS_QC", "TAMBUR", "SHIPPING"] as const;

// F221: StationKind → o istasyonda oturum açmak için gereken MOBILE izni. mobile:*
// ve * wildcard'ları matchesPermission ile geçer; yalnız ilgili izne sahip operatör
// o tür istasyonu açabilir/devralabilir (örn. mobile:kk1'li kullanıcı TAMBUR açamaz).
const STATION_KIND_PERM: Record<string, string> = {
  RAW_QC: "mobile:kk1",
  PROCESS_QC: "mobile:kk2-kursun",
  TAMBUR: "mobile:tambur",
  SHIPPING: "mobile:tarti-paket",
};

/** Oturum açma yetkisi olan mobil ekran izinleri (routes + peripheral for-session paylaşır). */
export const MOBILE_SESSION_PERMS = [
  "mobile:kk1",
  "mobile:kk2-kursun",
  "mobile:tambur",
  "mobile:tarti-paket",
] as const;

function isSessionableKind(kind: StationKind): boolean {
  return (SESSIONABLE_STATION_KINDS as readonly string[]).includes(kind);
}

function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Liste/detay cevaplarının ortak ilişki seçimi (panel + mobil onay ekranı +
 *  oturum aktivite dökümü — work-session-activity.service — besler). */
export const SESSION_INCLUDE = {
  user: { select: { id: true, username: true, fullName: true } },
  device: { select: { id: true, deviceId: true, name: true, kind: true } },
  machine: { select: { id: true, code: true, name: true } },
  station: { select: { id: true, code: true, name: true, kind: true } },
} as const;

/** "Devralan" ardıl oturumun tooltip için minimal alanları. */
const SUCCESSOR_SELECT = {
  id: true,
  startedAt: true,
  machineId: true,
  deviceId: true,
  user: { select: { fullName: true } },
  device: { select: { name: true } },
  machine: { select: { code: true, name: true } },
  station: { select: { name: true } },
} as const;
// JS new Date() (endedAt) ile DB now() (startedAt) aynı takeover tx'inde birkaç ms
// sapar → eşleştirme toleransı.
const SUCCESSOR_WINDOW_MS = 5000;

type SuccessorSrc = {
  id: string;
  endReason: WorkSessionEndReason | null;
  machineId: string | null;
  deviceId: string;
  endedAt: Date | null;
};

/**
 * TAKEOVER (aynı MAKİNE) / NEW_LOGIN (aynı CİHAZ) ile kapanan oturuma, onu kapatan
 * "devralan" ardıl oturumu bağlar. Tek-aktif-oturum invariant'ı: ardıl, bu oturum
 * kapandığı transaction'da açıldığından startedAt ≈ endedAt. Sayfa başına 2 TOPLU
 * sorgu (N+1 yok) + dar zaman penceresi → aday kümesi küçük; [machineId/deviceId,
 * startedAt] index'leri karşılar. Migration/yeni kolon yok.
 */
async function attachSuccessors<T extends SuccessorSrc>(
  items: T[],
): Promise<Array<T & { successor: unknown }>> {
  const takeovers = items.filter((s) => s.endReason === "TAKEOVER" && s.machineId && s.endedAt);
  const newLogins = items.filter((s) => s.endReason === "NEW_LOGIN" && s.endedAt);
  if (takeovers.length === 0 && newLogins.length === 0) {
    return items.map((s) => ({ ...s, successor: null }));
  }

  // Her oturum için DAR pencereli OR koşulu — geniş min/max tarama yerine (sayfa
  // günlere yayılsa da) her dal endedAt±window'la sınırlı, [machineId/deviceId,
  // startedAt] index'iyle ~1 satır döner. Tek sorgu, aday kümesi = ardıllar.
  const win = (s: SuccessorSrc) => ({
    gte: new Date((s.endedAt as Date).getTime() - SUCCESSOR_WINDOW_MS),
    lte: new Date((s.endedAt as Date).getTime() + SUCCESSOR_WINDOW_MS),
  });

  const [machineCands, deviceCands] = await Promise.all([
    takeovers.length
      ? prisma.workSession.findMany({
          where: { OR: takeovers.map((s) => ({ machineId: s.machineId, startedAt: win(s) })) },
          orderBy: { startedAt: "asc" },
          select: SUCCESSOR_SELECT,
        })
      : [],
    newLogins.length
      ? prisma.workSession.findMany({
          where: { OR: newLogins.map((s) => ({ deviceId: s.deviceId, startedAt: win(s) })) },
          orderBy: { startedAt: "asc" },
          select: SUCCESSOR_SELECT,
        })
      : [],
  ]);

  // Pencere içindeki adaylardan endedAt'e EN YAKIN olanı seç — ilk-eşleşen DEĞİL.
  // Gerçek ardıl aynı tx'te açıldığından startedAt≈endedAt (fark ≈0); ÖNCEKİ oturum
  // ise kendi süresi kadar erken başlar. Hızlı ardışık devralmada önceki oturum da
  // simetrik ±5s pencereye girebilir → "en yakın" ile önceki yanlışlıkla seçilmez.
  type Cand = (typeof machineCands)[number];
  const closest = (cands: Cand[], match: (c: Cand) => boolean, endedAt: Date): Cand | null => {
    let best: Cand | null = null;
    let bestGap = Infinity;
    for (const c of cands) {
      if (!match(c)) continue;
      const gap = Math.abs(c.startedAt.getTime() - endedAt.getTime());
      if (gap <= SUCCESSOR_WINDOW_MS && gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    return best;
  };
  const successorOf = (s: SuccessorSrc) => {
    if (s.endReason === "TAKEOVER" && s.machineId && s.endedAt) {
      return closest(machineCands, (c) => c.id !== s.id && c.machineId === s.machineId, s.endedAt);
    }
    if (s.endReason === "NEW_LOGIN" && s.endedAt) {
      return closest(deviceCands, (c) => c.id !== s.id && c.deviceId === s.deviceId, s.endedAt);
    }
    return null;
  };

  return items.map((s) => ({ ...s, successor: successorOf(s) }));
}

export class WorkSessionService {
  /**
   * Oturum aç. Body'de machineId XOR stationId (istasyon-oturumu yalnız makinesiz
   * istasyonda). Aynı cihazın açık oturumu NEW_LOGIN ile, devralınan makinedeki
   * oturum TAKEOVER ile kapanır — hepsi tek transaction (atomik claim).
   */
  static async open(input: {
    userId: string;
    deviceRowId: string;
    machineId?: string | null;
    stationId?: string | null;
    confirmTakeover?: boolean;
    /** F221: sağlanırsa istasyon-türü izni ENFORCE edilir. Controller req.user.permissions'ı
     *  HER ZAMAN geçirir (0-izinli kullanıcı = [] → reddedilir). Omit = güvenilen dahili
     *  çağrı (test/servis-içi) → kontrol atlanır. Güvenlik sınırı controller'dadır. */
    permissions?: readonly string[];
  }): Promise<ApiResponse<unknown>> {
    const machineId = input.machineId ?? null;
    const stationIdInput = input.stationId ?? null;
    if ((machineId ? 1 : 0) + (stationIdInput ? 1 : 0) !== 1) {
      throw AppError.badRequest("machineId veya stationId — tam biri zorunlu");
    }

    let stationId: string;
    if (machineId) {
      const machine = await prisma.machine.findFirst({
        where: { id: machineId, isActive: true },
        select: {
          id: true,
          stationId: true,
          station: { select: { id: true, kind: true, isActive: true } },
        },
      });
      if (!machine || !machine.station.isActive) {
        throw AppError.badRequest("Makine bulunamadı veya pasif");
      }
      if (!isSessionableKind(machine.station.kind)) {
        throw AppError.badRequest("Bu istasyon türünde çalışma oturumu açılamaz");
      }
      // F221: istasyon türü izni (yalnız mobile:kk1 olan TAMBUR makinesini açamaz/devralamaz).
      const needM = STATION_KIND_PERM[machine.station.kind];
      if (input.permissions !== undefined && needM && !matchesPermission(input.permissions, needM)) {
        throw AppError.forbidden("Bu istasyon türünde oturum açma yetkiniz yok");
      }
      stationId = machine.stationId;

      // Devralma teyidi (warn-then-confirm): makinede BAŞKA cihazın açık oturumu
      // varsa 409 MACHINE_OCCUPIED döner; istemci operatöre "Bu makinede X çalışıyor —
      // devral?" sorup confirmTakeover=true ile tekrar dener. Check-then-act yarışının
      // arkası partial unique ile kapalı (aşağıda P2002 → 409).
      if (!input.confirmTakeover) {
        const occupant = await prisma.workSession.findFirst({
          where: { machineId, endedAt: null, NOT: { deviceId: input.deviceRowId } },
          select: {
            startedAt: true,
            user: { select: { fullName: true } },
            device: { select: { name: true } },
          },
        });
        if (occupant) {
          throw AppError.conflict("Bu makinede şu an başka bir oturum açık", {
            code: "MACHINE_OCCUPIED",
            occupiedBy: {
              userFullName: occupant.user.fullName,
              deviceName: occupant.device.name,
              startedAt: occupant.startedAt,
            },
          });
        }
      }
    } else {
      const station = await prisma.station.findFirst({
        where: { id: stationIdInput as string, isActive: true },
        select: { id: true, kind: true },
      });
      if (!station) throw AppError.badRequest("İstasyon bulunamadı veya pasif");
      if (!isSessionableKind(station.kind)) {
        throw AppError.badRequest("Bu istasyon türünde çalışma oturumu açılamaz");
      }
      // F221: istasyon türü izni (makine dalıyla aynı).
      const needS = STATION_KIND_PERM[station.kind];
      if (input.permissions !== undefined && needS && !matchesPermission(input.permissions, needS)) {
        throw AppError.forbidden("Bu istasyon türünde oturum açma yetkiniz yok");
      }
      const machineCount = await prisma.machine.count({
        where: { stationId: station.id, isActive: true },
      });
      if (machineCount > 0) {
        throw AppError.badRequest(
          "Bu istasyonun makineleri var — oturum makine seçilerek açılmalı",
        );
      }
      stationId = station.id;
    }

    // F226: devralınacak açık oturumları tx KAPATMADAN ÖNCE yakala → devralma sonrası
    // her biri için TAKEOVER audit'i yaz (kim kimin oturumunu devraldı izlenebilsin).
    const takenOver =
      machineId && input.confirmTakeover
        ? await prisma.workSession.findMany({
            where: { machineId, endedAt: null },
            select: { id: true, userId: true },
          })
        : [];

    const now = new Date();
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        // Aynı cihazın açık oturumu → vardiya/yer değişimi.
        await tx.workSession.updateMany({
          where: { deviceId: input.deviceRowId, endedAt: null },
          data: { endedAt: now, endReason: "NEW_LOGIN" as WorkSessionEndReason },
        });
        // Devralınan makinedeki (başka cihazın) açık oturumu → devral. YALNIZ teyitli
        // istekte kapatılır: teyitsiz istekte precheck'i atlatan yarış, buradaki
        // kapatmaya değil create'in partial unique'ine çarpar (P2002 → 409) —
        // onaysız devralma sızamaz. (Cross-device NEW_LOGIN kapanışından ÖNCE koşar →
        // devralınan makinedeki oturum daha isabetli TAKEOVER nedeniyle kapanır.)
        if (machineId && input.confirmTakeover) {
          await tx.workSession.updateMany({
            where: { machineId, endedAt: null },
            data: { endedAt: now, endReason: "TAKEOVER" as WorkSessionEndReason },
          });
        }
        // Bir operatör = tek yer: bu kullanıcının BAŞKA cihazlardaki (devralma dışında
        // kalan) açık oturumlarını da kapat — tablet A'da açık unutup B'ye geçince A
        // boşa düşsün. Aynı-cihaz yukarıda, devralınan-makine TAKEOVER ile kapandı;
        // burada geriye kalan diğer-cihaz oturumları NEW_LOGIN ile kapanır.
        await tx.workSession.updateMany({
          where: {
            userId: input.userId,
            endedAt: null,
            deviceId: { not: input.deviceRowId },
          },
          data: { endedAt: now, endReason: "NEW_LOGIN" as WorkSessionEndReason },
        });
        return tx.workSession.create({
          data: {
            userId: input.userId,
            deviceId: input.deviceRowId,
            machineId,
            stationId,
            lastActivityAt: now,
          },
          include: SESSION_INCLUDE,
        });
      });
    } catch (e) {
      if (isP2002(e)) {
        throw AppError.conflict(
          "Bu makinede az önce başka bir oturum açıldı — tekrar deneyin",
          { code: "SESSION_RACE" },
        );
      }
      throw e;
    }

    await AuditService.log({
      userId: input.userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: { deviceId: input.deviceRowId, machineId, stationId },
    }).catch(() => undefined);

    // F226: devralınan oturumlar için TAKEOVER izi (best-effort, tx dışı, seri).
    for (const s of takenOver) {
      await AuditService.log({
        userId: input.userId,
        action: "UPDATE",
        tableName: TABLE,
        recordId: s.id,
        newData: { endReason: "TAKEOVER", takenOverFromUserId: s.userId, byUserId: input.userId, machineId },
      }).catch(() => undefined);
    }

    return { success: true, data: created };
  }

  /** Cihazın açık oturumlarının TÜMÜNÜ kapat (idempotent — açık oturum yoksa closed:false).
   *  Eskiden findFirst ile (orderBy'sız) RASTGELE tek oturum kapanıyordu: cihazda kalıntı
   *  oturum birikmişse çıkış eski kalıntıyı kapatıp GERÇEK oturumu açık bırakabiliyordu
   *  ("ayak izinde eski kullanıcı hâlâ aktif" saha bug'ı). Logout = cihaz temiz. */
  static async closeForDevice(
    deviceRowId: string,
    reason: "LOGOUT" | "IDLE" = "LOGOUT",
    auditUserId?: string,
  ): Promise<ApiResponse<{ closed: boolean }>> {
    const res = await prisma.workSession.updateMany({
      where: { deviceId: deviceRowId, endedAt: null },
      data: { endedAt: new Date(), endReason: reason as WorkSessionEndReason },
    });
    if (res.count > 0) {
      await AuditService.log({
        userId: auditUserId,
        action: "UPDATE",
        tableName: TABLE,
        recordId: deviceRowId,
        newData: { endReason: reason, closedCount: res.count },
      }).catch(() => undefined);
    }
    return { success: true, data: { closed: res.count > 0 } };
  }

  /**
   * Cihazın { active, lastPlace } durumu. active = idle süpürmesinden geçmiş aktif
   * oturum (ilişkilerle); lastPlace = cihazın SON oturumunun yeri (kapalı dahil) —
   * onay ekranının "Sarım-2'desiniz, doğru mu?" varsayılanı. Server-side hafıza:
   * cihaz storage'ı silinse de yer hatırlanır. Pasifleşen makine/istasyon önerilmez.
   */
  static async current(deviceRowId: string, requestUserId?: string): Promise<ApiResponse<unknown>> {
    let activeMin = await resolveActiveSession(deviceRowId);
    // Öz-onarım: aktif oturum BAŞKA kullanıcıya aitse (önceki kullanıcının logout'u
    // kaçmış kalıntı) yeni kullanıcıya BENİMSETME — vardiya değişimi (NEW_LOGIN) ile
    // kapat, active=null dön. lastPlace korunur → yer onayı aynı makineyi yeni
    // kullanıcı adına önerir/açar.
    if (activeMin && requestUserId && activeMin.userId !== requestUserId) {
      const reclaim = await prisma.workSession.updateMany({
        where: { id: activeMin.id, endedAt: null },
        data: { endedAt: new Date(), endReason: "NEW_LOGIN" as WorkSessionEndReason },
      });
      // F285: başka kullanıcının oturumunu kapatan öz-onarım iz bırakmıyordu
      // (closeForNewLogin loglar). Best-effort audit — koşullu (0 satır kapatılırsa
      // eşzamanlı başka bir kapanış araya girmiştir, log atma).
      if (reclaim.count > 0) {
        await AuditService.log({
          userId: requestUserId,
          action: "UPDATE",
          tableName: TABLE,
          recordId: activeMin.id,
          newData: {
            endReason: "NEW_LOGIN",
            reclaimedFromUserId: activeMin.userId,
            byUserId: requestUserId,
          },
        }).catch(() => undefined);
      }
      activeMin = null;
    }
    const active = activeMin
      ? await prisma.workSession.findUnique({
          where: { id: activeMin.id },
          include: SESSION_INCLUDE,
        })
      : null;

    const last = await prisma.workSession.findFirst({
      where: { deviceId: deviceRowId },
      orderBy: { startedAt: "desc" },
      select: {
        machine: { select: { id: true, code: true, name: true, isActive: true } },
        station: { select: { id: true, code: true, name: true, kind: true, isActive: true } },
      },
    });
    const lastPlace =
      last && last.station.isActive && (last.machine ? last.machine.isActive : true)
        ? { machine: last.machine, station: last.station }
        : null;

    return { success: true, data: { active, lastPlace } };
  }

  /**
   * Oturum açılabilir yerler — istasyon-gruplu makine listesi (onay ekranındaki
   * manuel seçim). Makinesiz SHIPPING istasyonu machines:[] ile döner → istemci
   * istasyon-oturumu açar; tek makineli istasyonda istemci makine sorusunu atlar.
   */
  static async places(): Promise<ApiResponse<unknown[]>> {
    const stations = await prisma.station.findMany({
      where: {
        isActive: true,
        kind: { in: SESSIONABLE_STATION_KINDS as unknown as StationKind[] },
      },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        machines: {
          where: { isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        },
      },
    });
    return { success: true, data: stations };
  }

  /**
   * QR → makine çözümü: makine QR etiketi ham machine.code taşır (MAK-...), tam
   * eşleşme ile aranır (barkod=equals kuralı — contains/ILIKE YASAK, seq scan).
   */
  static async resolveMachineByCode(code: string): Promise<ApiResponse<unknown>> {
    const normalized = (code ?? "").trim();
    if (!normalized) throw AppError.badRequest("Makine kodu (code) zorunlu");
    const machine = await prisma.machine.findFirst({
      where: { code: normalized, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        station: { select: { id: true, code: true, name: true, kind: true, isActive: true } },
      },
    });
    if (!machine || !machine.station.isActive) throw AppError.notFound("Makine bulunamadı");
    return { success: true, data: machine };
  }

  /** Canlı panel: tüm aktif oturumlar. Okuma anında tembel idle süpürmesi yapılır. */
  static async listActive(): Promise<ApiResponse<unknown[]>> {
    await sweepIdleSessions();
    const items = await prisma.workSession.findMany({
      where: { endedAt: null },
      include: SESSION_INCLUDE,
      orderBy: { startedAt: "asc" },
    });
    return { success: true, data: items };
  }

  /** Geçmiş (ayak izi) sorgusu — kullanıcı/cihaz/makine/istasyon/tarih filtreli, offset sayfalı. */
  static async history(q: {
    userId?: string;
    deviceId?: string;
    machineId?: string;
    stationId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<unknown>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
    const where: Prisma.WorkSessionWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      // Cihaz dökümü (Tanımlar → Cihazlar detayı) — [deviceId, startedAt] index'i
      // sıralamayı da karşılar (sort-free backward scan).
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.machineId ? { machineId: q.machineId } : {}),
      ...(q.stationId ? { stationId: q.stationId } : {}),
      ...(q.from || q.to
        ? { startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };
    // F275: MAX_OFFSET guard (skip>10K → Türkçe 400). WorkSession her login/vardiyada
    // büyür; ham (page-1)*pageSize sınırsız derin OFFSET taramasına açıktı.
    const { skip, take } = buildPagination(page, pageSize);
    const [total, items] = await Promise.all([
      prisma.workSession.count({ where }),
      prisma.workSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: { startedAt: "desc" },
        skip,
        take,
      }),
    ]);
    const data = await attachSuccessors(items);
    return {
      success: true,
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Admin: oturumu zorla kapat (ADMIN). Zaten kapalıysa 409 (idempotent değil — bilinçli). */
  static async forceClose(id: string, adminUserId?: string): Promise<ApiResponse<{ id: string }>> {
    const res = await prisma.workSession.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: new Date(), endReason: "ADMIN" as WorkSessionEndReason },
    });
    if (res.count === 0) {
      throw AppError.conflict("Oturum zaten kapalı veya bulunamadı");
    }
    await AuditService.log({
      userId: adminUserId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      newData: { endReason: "ADMIN" },
    }).catch(() => undefined);
    return { success: true, data: { id } };
  }
}
