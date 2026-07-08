// =============================================================================
// TeksERP - Peripheral Device (birleşik cihaz kaydı) Service
// =============================================================================
// BaseService + validateRefs. Bare BaseController Zod
// taşımaz → FK/sahiplik/port/medya hijyeni serviste. Ayrıca per-kind şablon yönlendirme
// (setTemplateRoute) ve bağlantı testi (test). (register-bt ucu 2026-07'de kaldırıldı.)
// İzin: donanım ailesiyle tutarlı `station:read/write`.
// =============================================================================

import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { dispatchNativeSend } from "./helpers/printer-transport";
import { readLabelNativeSendEnabled } from "./system-setting.service";
import { LabelKind, ConnectionType, PrinterLanguage, PeripheralKind } from "@prisma/client";
import type { ApiResponse } from "../types/api.types";

const PERIPHERAL_TABLE = "PERIPHERAL_DEVICE";
const ROUTE_TABLE = "PERIPHERAL_TEMPLATE_ROUTE";

/** create/update payload'undan templateRoutes alanını çıkar (Prisma'ya gitmesin). */
function takeRoutes(data: Record<string, unknown>): Array<{ kind: LabelKind; templateId: string | null }> | null {
  const raw = data.templateRoutes;
  delete data.templateRoutes;
  if (!Array.isArray(raw)) return null;
  const out: Array<{ kind: LabelKind; templateId: string | null }> = [];
  for (const r of raw) {
    if (r && typeof r === "object" && typeof (r as { kind?: unknown }).kind === "string") {
      const kind = (r as { kind: LabelKind }).kind;
      const tid = (r as { templateId?: unknown }).templateId;
      out.push({ kind, templateId: typeof tid === "string" && tid ? tid : null });
    }
  }
  return out;
}

export class PeripheralDeviceService extends BaseService {
  /** KALICI silinenler (deletedAt dolu) hiçbir listede görünmez — pasifler görünür. */
  protected extraWhere(): Record<string, unknown> {
    return { deletedAt: null };
  }

  private async validateRefs(data: Record<string, unknown>, existingId?: string): Promise<void> {
    // Sahiplik: makineye-sabit VEYA makinesiz-istasyona-sabit VEYA tablete-bağlı —
    // en fazla BİRİ (boş serbest). Update'te mevcut kayıtla BİRLEŞTİRİLMİŞ sahiplik
    // kontrol edilir: tek alan gönderip (diğerini temizlemeden) çift sahiplik
    // oluşturma deliği kapalı — istemci diğer sahiplik alanını null göndermeli.
    const OWNER_FIELDS = ["machineId", "stationId", "deviceId"] as const;
    const effective: Record<string, string | null> = { machineId: null, stationId: null, deviceId: null };
    const existing = existingId
      ? await prisma.peripheralDevice.findUnique({
          where: { id: existingId },
          select: { machineId: true, stationId: true, deviceId: true },
        })
      : null;
    for (const f of OWNER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, f)) {
        effective[f] = typeof data[f] === "string" && data[f] ? (data[f] as string) : null;
      } else if (existing) {
        effective[f] = existing[f];
      }
    }
    if (OWNER_FIELDS.filter((f) => effective[f]).length > 1) {
      throw AppError.badRequest(
        "Donanım makineye, makinesiz istasyona VEYA tablete bağlanır — yalnız biri (diğer sahiplik alanını temizleyin)",
      );
    }
    if (data.port !== undefined && data.port !== null) {
      const p = Number(data.port);
      if (!Number.isInteger(p) || p <= 0 || p > 65535) throw AppError.badRequest("Port 1-65535 arası olmalı");
    }
    // Giriş cihazı (SCALE/METER) protokol alanları — additive, hepsi opsiyonel.
    if (data.decimals !== undefined && data.decimals !== null) {
      const d = Number(data.decimals);
      if (!Number.isInteger(d) || d < 0 || d > 4) throw AppError.badRequest("Ondalık 0-4 arası olmalı");
    }
    if (data.timeoutMs !== undefined && data.timeoutMs !== null) {
      const t = Number(data.timeoutMs);
      if (!Number.isInteger(t) || t < 100 || t > 30000) throw AppError.badRequest("Zaman aşımı 100-30000 ms arası olmalı");
    }
    if (data.scale !== undefined && data.scale !== null) {
      const s = Number(data.scale);
      if (!Number.isFinite(s) || s <= 0) throw AppError.badRequest("Ölçek (scale) pozitif olmalı");
    }
    // Yazıcı MEDYASI (Etiket Stüdyosu v2 — cihazda) — additive, opsiyonel.
    for (const dim of ["labelWidthMm", "labelHeightMm"] as const) {
      if (data[dim] !== undefined && data[dim] !== null) {
        const v = Number(data[dim]);
        if (!Number.isFinite(v) || v < 10 || v > 500) throw AppError.badRequest("Etiket ölçüsü 10-500 mm arası olmalı");
      }
    }
    if (data.labelDpi !== undefined && data.labelDpi !== null) {
      const v = Number(data.labelDpi);
      if (!Number.isInteger(v) || v < 50 || v > 1200) throw AppError.badRequest("DPI 50-1200 arası olmalı");
    }
    if (data.labelGapMm !== undefined && data.labelGapMm !== null) {
      const v = Number(data.labelGapMm);
      if (!Number.isFinite(v) || v < 0 || v > 50) throw AppError.badRequest("Etiket arası boşluk 0-50 mm arası olmalı");
    }
    // Medya doğrudan cihazda (yukarıda) — ayrı "Boyutlar" (LabelFormatProfile) kataloğu kaldırıldı.
    if (typeof data.machineId === "string" && data.machineId) {
      const mc = await prisma.machine.findFirst({ where: { id: data.machineId, isActive: true }, select: { id: true } });
      if (!mc) throw AppError.badRequest("Makine bulunamadı veya pasif");
    }
    if (typeof data.deviceId === "string" && data.deviceId) {
      const dv = await prisma.device.findFirst({ where: { id: data.deviceId, isActive: true }, select: { id: true } });
      if (!dv) throw AppError.badRequest("Cihaz (tablet) bulunamadı veya pasif");
    }
    if (typeof data.stationId === "string" && data.stationId) {
      const st = await prisma.station.findFirst({ where: { id: data.stationId, isActive: true }, select: { id: true } });
      if (!st) throw AppError.badRequest("İstasyon bulunamadı veya pasif");
      // Yan yana özdeş HC-06 belirsizliğinin tek çözümü makine bağı — makinesi olan
      // istasyonda donanım istasyona DEĞİL makineye bağlanmalı.
      const machineCount = await prisma.machine.count({
        where: { stationId: data.stationId, isActive: true },
      });
      if (machineCount > 0) {
        throw AppError.badRequest(
          "Makinesi olan istasyona doğrudan donanım bağlanamaz — donanımı makineye bağlayın",
        );
      }
    }
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    delete data.printerModelId; // eski istemci toleransı — PrinterModel alanı 2026-07'de kaldırıldı
    delete data.deletedAt; // silinme damgası YALNIZ hardDelete'ten yazılır (PATCH ile un-delete kapalı)
    const routes = takeRoutes(data); // data'dan çıkar (Prisma create relation şekli farklı)
    // Yazıcı dili cihazın kendi üstünde — dilsiz yazıcı kaydı globalden sürpriz
    // etkilenir, en baştan reddet (DB nullable kalır: eski satırlar için).
    if (data.kind === PeripheralKind.LABEL_PRINTER && !data.languageOverride) {
      throw AppError.badRequest("Yazıcı için dil seçimi zorunlu");
    }
    await this.validateRefs(data);
    const res = await super.create(data, userId);
    const id = (res.data as { id?: string } | null)?.id;
    if (id && routes) await this.applyRoutes(id, routes, userId);
    return res;
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    delete data.printerModelId; // eski istemci toleransı — PrinterModel alanı 2026-07'de kaldırıldı
    delete data.deletedAt; // silinme damgası YALNIZ hardDelete'ten yazılır (PATCH ile un-delete kapalı)
    const routes = takeRoutes(data);
    const existing = await prisma.peripheralDevice.findUnique({
      where: { id },
      select: { kind: true, languageOverride: true, deletedAt: true },
    });
    // KALICI silinmiş kayıt düzenlenemez/aktifleştirilemez (restore = PATCH isActive:true
    // buraya düşer) — satır yalnız veri bütünlüğü için durur.
    if (existing?.deletedAt) {
      throw AppError.badRequest("Silinmiş cihaz düzenlenemez veya geri getirilemez");
    }
    // Dil kuralı HEDEF türe göre (PATCH kısmiliği korunur): tür yazıcı KALIYORSA/
    // OLUYORSA etkin dil boş olamaz; yazıcılıktan çıkan cihazda (örn. → SCALE)
    // dilin temizlenmesi meşrudur.
    const touchesLang = Object.prototype.hasOwnProperty.call(data, "languageOverride");
    const touchesKind = Object.prototype.hasOwnProperty.call(data, "kind");
    if (touchesLang || touchesKind) {
      const targetKind = touchesKind && data.kind ? data.kind : existing?.kind;
      const effectiveLang = touchesLang ? data.languageOverride : existing?.languageOverride;
      if (targetKind === PeripheralKind.LABEL_PRINTER && !effectiveLang) {
        throw AppError.badRequest("Yazıcı için dil seçimi zorunlu");
      }
    }
    await this.validateRefs(data, id);
    const res = await super.update(id, data, userId);
    if (routes) await this.applyRoutes(id, routes, userId);
    return res;
  }

  /**
   * KALICI silme — fiziksel DELETE DEĞİL (users.deletedAt kalıbı): satır veri
   * bütünlüğü için durur, deletedAt damgalanır, hiçbir listede görünmez ve geri
   * getirilemez. Kod DEL- önekiyle serbest bırakılır (aynı kodla yeni cihaz
   * açılabilir); yer sahipliği sökülür (for-session/for-device asla çözmesin).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const old = await prisma.peripheralDevice.findUnique({ where: { id } });
    if (!old) return { success: false, data: null, message: "Kayıt bulunamadı" };
    if (old.deletedAt) return { success: true, data: old, message: "Kayıt zaten silinmiş" }; // idempotent
    const freedCode = `DEL-${Date.now().toString(36).toUpperCase()}-${old.code}`.slice(0, 48);
    const updated = await prisma.peripheralDevice.update({
      where: { id },
      data: {
        deletedAt: new Date(), isActive: false, code: freedCode,
        machineId: null, stationId: null, deviceId: null,
      },
    });
    await AuditService.log({
      userId, action: "DELETE", tableName: PERIPHERAL_TABLE, recordId: id,
      oldData: old as unknown as Record<string, unknown>,
      newData: { deletedAt: updated.deletedAt, freedCode },
    }).catch(() => undefined);
    return { success: true, data: updated, message: "Cihaz kalıcı olarak silindi (kayıt veri bütünlüğü için saklanır)" };
  }

  /** Form'dan gelen templateRoutes[] → setTemplateRoute (boş templateId → kaldır). */
  private async applyRoutes(
    id: string,
    routes: Array<{ kind: LabelKind; templateId: string | null }>,
    userId?: string,
  ): Promise<void> {
    for (const r of routes) {
      if (!Object.values(LabelKind).includes(r.kind)) continue;
      await this.setTemplateRoute(id, r.kind, r.templateId, userId);
    }
  }

  /** Cihaz başına LabelKind→şablon yönlendirme upsert (templateId boş → kaldır). */
  async setTemplateRoute(
    peripheralId: string,
    kind: LabelKind,
    templateId: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ peripheralId: string; kind: LabelKind; templateId: string | null }>> {
    const peripheral = await prisma.peripheralDevice.findUnique({ where: { id: peripheralId }, select: { id: true } });
    if (!peripheral) throw AppError.notFound("Cihaz bulunamadı");
    if (!Object.values(LabelKind).includes(kind)) throw AppError.badRequest("Geçersiz etiket türü");

    if (!templateId) {
      await prisma.peripheralTemplateRoute.deleteMany({ where: { peripheralId, kind } });
    } else {
      // TEK HAVUZ (Etiket Stüdyosu v2): şablon türden bağımsız — kind eşleşme
      // şartı kalktı; yalnız var + aktif + kalıcı-silinmemiş kontrolü.
      const tpl = await prisma.labelTemplate.findFirst({
        where: { id: templateId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!tpl) throw AppError.badRequest("Şablon bulunamadı veya pasif");
      await prisma.peripheralTemplateRoute.upsert({
        where: { peripheralId_kind: { peripheralId, kind } },
        update: { templateId },
        create: { peripheralId, kind, templateId },
      });
    }
    await AuditService.log({
      userId, action: "UPDATE", tableName: ROUTE_TABLE, recordId: peripheralId,
      newData: { kind, templateId: templateId ?? null },
    }).catch(() => undefined);
    return { success: true, data: { peripheralId, kind, templateId: templateId ?? null } };
  }

  /**
   * Tablet auto-discovery: bir makineye SABİT, belirli türdeki AKTİF cihazları döner
   * (protokol alanları dahil). Tablet `req.device.machineId`'sine göre kendi metre/
   * kantar/yazıcılarını çözer — machineId yoksa boş liste (sim/manuel'e düşer).
   */
  async getForDevice(
    owner: { deviceId?: string | null; machineId?: string | null },
    kind: string,
  ): Promise<ApiResponse<unknown[]>> {
    const validKind = Object.values(PeripheralKind).includes(kind as PeripheralKind);
    if (!validKind) throw AppError.badRequest("Geçersiz cihaz türü (kind)");
    const base = { kind: kind as PeripheralKind, isActive: true };
    // Yeni model: donanım DOĞRUDAN cihaza (deviceId) atanır. Geriye-uyum: deviceId-owned
    // donanım yoksa cihazın makinesindeki (machineId) donanıma düşer — eski makine-atamalı
    // kurulum bozulmasın. machineId yoksa boş liste (sim/manuel'e düşer).
    if (owner.deviceId) {
      // F217: cihaza atanan donanım — hem doğrudan FK (peripheralDevice.deviceId)
      // hem M:N join (deviceLinks). device.service.detail() ikisini de gösteriyor;
      // admin bir donanımı deviceId FK ile bağlarsa tablet artık for-device ile çözer.
      const direct = await prisma.peripheralDevice.findMany({
        where: {
          ...base,
          OR: [
            { deviceId: owner.deviceId },
            { deviceLinks: { some: { deviceId: owner.deviceId } } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      if (direct.length > 0) return { success: true, data: direct };
    }
    if (owner.machineId) {
      const byMachine = await prisma.peripheralDevice.findMany({
        where: { ...base, machineId: owner.machineId },
        orderBy: { createdAt: "asc" },
      });
      return { success: true, data: byMachine };
    }
    return { success: true, data: [] };
  }

  /**
   * OTURUM-KAPSAMLI donanım çözümü (for-device'ın halefi — Faz 6'da onun yerini alır).
   * Aktif çalışma oturumunun YERİ tek kaynak: makine-oturumu → o makineye sabit
   * donanım; makinesiz istasyon-oturumu (SHIPPING) → istasyona sabit donanım.
   * Oturum yok → BOŞ liste (fail-closed: tablet backend'in vermediği hiçbir
   * cihaza bağlanmaz; istemci sim/manuel'e düşmez, yer onayı ister).
   */
  async getForSession(
    session: { machineId: string | null; stationId: string | null } | null,
    kind: string,
  ): Promise<ApiResponse<unknown[]>> {
    const validKind = Object.values(PeripheralKind).includes(kind as PeripheralKind);
    if (!validKind) throw AppError.badRequest("Geçersiz cihaz türü (kind)");
    if (!session) return { success: true, data: [] };
    const base = { kind: kind as PeripheralKind, isActive: true };
    if (session.machineId) {
      const byMachine = await prisma.peripheralDevice.findMany({
        where: { ...base, machineId: session.machineId },
        orderBy: { createdAt: "asc" },
      });
      return { success: true, data: byMachine };
    }
    if (session.stationId) {
      const byStation = await prisma.peripheralDevice.findMany({
        where: { ...base, stationId: session.stationId },
        orderBy: { createdAt: "asc" },
      });
      return { success: true, data: byStation };
    }
    return { success: true, data: [] };
  }

  /** Bağlantı testi: NETWORK_TCP → gerçek/simüle gönderim; diğerleri cihaz tarafı. */
  async test(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const p = await prisma.peripheralDevice.findUnique({ where: { id } });
    if (!p) throw AppError.notFound("Cihaz bulunamadı");
    if (p.connectionType !== ConnectionType.NETWORK_TCP) {
      return {
        success: true,
        data: { delivered: false, simulated: true, note: "BT/USB/seri test cihaz tarafında (mobil/Electron) yapılır." },
      };
    }
    if (!p.address) throw AppError.badRequest("Cihaz adresi (IP) tanımsız");
    const enabled = await readLabelNativeSendEnabled();
    const sample = "\x02L\r1911000010000010TEST\rE\r"; // minik PPLA noop — bağlantı kanıtı
    const result = await dispatchNativeSend(sample, {
      language: p.languageOverride ?? PrinterLanguage.PPLA,
      enabled,
      printerIp: p.address,
      port: p.port ?? undefined,
    });
    await AuditService.log({
      userId, action: "CREATE", tableName: PERIPHERAL_TABLE, recordId: id,
      newData: { test: true, delivered: result.delivered, simulated: result.simulated, target: result.target },
    }).catch(() => undefined);
    return { success: true, data: result };
  }
}
