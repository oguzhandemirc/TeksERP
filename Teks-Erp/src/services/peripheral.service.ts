// =============================================================================
// TeksERP - Peripheral Device (birleşik cihaz kaydı) Service
// =============================================================================
// BaseService + validateRefs (printer.service deseni). Bare BaseController Zod
// taşımaz → FK/sahiplik/port hijyeni serviste. Ayrıca per-kind şablon yönlendirme
// (setTemplateRoute), mobil BT yazıcı kaydı (registerBt) ve bağlantı testi (test).
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
  private async validateRefs(data: Record<string, unknown>): Promise<void> {
    // Sahiplik: makineye-sabit VEYA tablete-bağlı — ikisi birden OLAMAZ (boş serbest).
    if (
      typeof data.machineId === "string" && data.machineId &&
      typeof data.deviceId === "string" && data.deviceId
    ) {
      throw AppError.badRequest("Cihaz ya makineye ya da tablete bağlanır — ikisi birden olamaz");
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
    if (typeof data.printerModelId === "string" && data.printerModelId) {
      const m = await prisma.printerModel.findFirst({ where: { id: data.printerModelId, isActive: true }, select: { id: true } });
      if (!m) throw AppError.badRequest("Yazıcı modeli bulunamadı veya pasif");
    }
    if (typeof data.formatProfileId === "string" && data.formatProfileId) {
      const f = await prisma.labelFormatProfile.findFirst({ where: { id: data.formatProfileId, isActive: true }, select: { id: true } });
      if (!f) throw AppError.badRequest("Etiket format profili bulunamadı veya pasif");
    }
    if (typeof data.machineId === "string" && data.machineId) {
      const mc = await prisma.machine.findFirst({ where: { id: data.machineId, isActive: true }, select: { id: true } });
      if (!mc) throw AppError.badRequest("Makine bulunamadı veya pasif");
    }
    if (typeof data.deviceId === "string" && data.deviceId) {
      const dv = await prisma.device.findFirst({ where: { id: data.deviceId, isActive: true }, select: { id: true } });
      if (!dv) throw AppError.badRequest("Cihaz (tablet) bulunamadı veya pasif");
    }
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const routes = takeRoutes(data); // data'dan çıkar (Prisma create relation şekli farklı)
    await this.validateRefs(data);
    const res = await super.create(data, userId);
    const id = (res.data as { id?: string } | null)?.id;
    if (id && routes) await this.applyRoutes(id, routes, userId);
    return res;
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const routes = takeRoutes(data);
    await this.validateRefs(data);
    const res = await super.update(id, data, userId);
    if (routes) await this.applyRoutes(id, routes, userId);
    return res;
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
      const tpl = await prisma.labelTemplate.findFirst({ where: { id: templateId, kind, isActive: true }, select: { id: true } });
      if (!tpl) throw AppError.badRequest("Şablon bulunamadı / tür uyuşmuyor / pasif");
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

  /** Mobil: tablete-bağlı BT yazıcıyı merkezî kayda al (idempotent: deviceId+address). */
  async registerBt(
    input: { deviceId: string; address: string; name?: string; languageOverride?: PrinterLanguage | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const deviceId = input.deviceId;
    const address = (input.address ?? "").trim();
    if (!deviceId || !address) throw AppError.badRequest("deviceId ve address zorunlu");
    const dv = await prisma.device.findFirst({ where: { id: deviceId, isActive: true }, select: { id: true } });
    if (!dv) throw AppError.badRequest("Cihaz (tablet) bulunamadı veya pasif");

    const name = (input.name?.trim() || address).slice(0, 100);
    const existing = await prisma.peripheralDevice.findFirst({
      where: { deviceId, address, connectionType: ConnectionType.BLUETOOTH_SPP },
      select: { id: true },
    });

    let record;
    if (existing) {
      record = await prisma.peripheralDevice.update({
        where: { id: existing.id },
        data: {
          name, isActive: true, lastSeenAt: new Date(),
          ...(input.languageOverride !== undefined ? { languageOverride: input.languageOverride } : {}),
        },
      });
    } else {
      const code = await this.uniqueBtCode(address);
      record = await prisma.peripheralDevice.create({
        data: {
          code, name, kind: "LABEL_PRINTER", connectionType: ConnectionType.BLUETOOTH_SPP,
          address, deviceId, lastSeenAt: new Date(),
          ...(input.languageOverride ? { languageOverride: input.languageOverride } : {}),
        },
      });
    }
    // Cihaz↔donanım join (M:N) — getForDevice artık join'den çözer.
    await prisma.devicePeripheral.upsert({
      where: { deviceId_peripheralId: { deviceId, peripheralId: record.id } },
      create: { deviceId, peripheralId: record.id },
      update: {},
    });
    await AuditService.log({
      userId, action: existing ? "UPDATE" : "CREATE", tableName: PERIPHERAL_TABLE, recordId: record.id,
      newData: { deviceId, address, connectionType: "BLUETOOTH_SPP" },
    }).catch(() => undefined);
    return { success: true, data: record };
  }

  /** code çakışmasını önleyen BT yazıcı kodu (BT-<MAC son8> + sayaç). */
  private async uniqueBtCode(address: string): Promise<string> {
    const base = `BT-${address.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase() || "PRN"}`;
    let code = base;
    for (let i = 1; i < 50; i++) {
      const exists = await prisma.peripheralDevice.findUnique({ where: { code }, select: { id: true } });
      if (!exists) return code;
      code = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
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
      // Cihaza atanan donanım = join (DevicePeripheral) — paylaşımlı (M:N).
      const direct = await prisma.peripheralDevice.findMany({
        where: { ...base, deviceLinks: { some: { deviceId: owner.deviceId } } },
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
