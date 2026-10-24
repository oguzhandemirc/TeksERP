// =============================================================================
// Yazdırma geçmişi satırının İSTEK KÜNYESİ (izlenebilirlik A1) — yalnız GÖSTERİM
// =============================================================================
// Kim (token) · hangi cihaz · hangi kaynak · hangi sürüm · hangi istasyon. Hiçbiri yetki
// kararı değildir: masaüstü panelin kurulum kimliği başlığı uydurulabilir, değer yalnız ekranda
// cihaz ADINI göstermeye yarar (`constants/client-info.ts` başlığı). Kullanıcı ASLA gövdeden okunmaz.
// =============================================================================

import type { Request } from "express";
import prisma from "../../lib/prisma";
import { readClientLabelHeaders, type ClientKind } from "../../constants/client-info";
import type { PrintSource } from "../../constants/print-subject-catalog";

export interface PrintJobRequestContext {
  userId: string | null;
  deviceRefId: string | null;
  source: PrintSource;
  appVersion: string | null;
  stationId: string | null;
  machineId: string | null;
}

const DEVICE_KIND_SOURCE: Record<string, PrintSource> = {
  TABLET: "TABLET",
  PHONE: "TELEFON",
  DESKTOP: "PANEL_MASAUSTU",
};
const CLIENT_KIND_SOURCE: Record<ClientKind, PrintSource> = {
  electron: "PANEL_MASAUSTU",
  web: "PANEL_WEB",
  mobil: "TABLET",
};

/**
 * İsteğin künyesini çözer. Hata FIRLATMAZ: çözülemeyen alan NULL kalır (telemetri iş yanıtını
 * değiştirmez). Saha cihazında istasyon/makine açık çalışma oturumundan YAN ETKİSİZ okunur
 * (`getStampContext` öz-onarım yazar — burada kullanılmaz).
 */
export async function resolvePrintJobContext(req: Request): Promise<PrintJobRequestContext> {
  const kunye = readClientLabelHeaders(req.headers);
  const ctx: PrintJobRequestContext = {
    userId: req.user?.userId ?? null,
    deviceRefId: req.device?.id ?? null,
    source: (req.device && DEVICE_KIND_SOURCE[req.device.kind]) || (kunye.kind && CLIENT_KIND_SOURCE[kunye.kind]) || "PANEL_WEB",
    appVersion: kunye.version,
    stationId: null,
    machineId: req.device?.machineId ?? null,
  };
  try {
    if (req.device) {
      const s = await prisma.workSession.findFirst({
        where: { deviceId: req.device.id, endedAt: null },
        orderBy: { startedAt: "desc" },
        select: { stationId: true, machineId: true },
      });
      ctx.stationId = s?.stationId ?? null;
      ctx.machineId = s?.machineId ?? ctx.machineId;
    } else {
      const instanceId = kunye.instanceId;
      const d = instanceId ? await prisma.device.findUnique({ where: { deviceId: instanceId }, select: { id: true } }) : null;
      ctx.deviceRefId = d?.id ?? null;
    }
  } catch {
    /* künye best-effort — satır cihazsız da yazılır */
  }
  return ctx;
}

/** İstek dışı (sunucu kendi basımı, iş) künyesi. */
export function serverPrintJobContext(userId?: string | null): PrintJobRequestContext {
  return { userId: userId ?? null, deviceRefId: null, source: "SUNUCU", appVersion: null, stationId: null, machineId: null };
}
