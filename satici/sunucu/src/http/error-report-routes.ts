// HATA RAPORLARI (satıcı portalı, salt-okuma): kurulum başına özet + bir kurulumun hata grupları.
// İçerik fabrikanın onaylı, kişisel verisiz özetidir (hata kodu/sınıfı · sürüm · bileşen · yol şablonu · dosya:satır).
import { ERROR_REPORT_SOURCES } from "../lisans-protokol";
import { prisma } from "../lib/prisma";
import { errorReportSummary, listErrorReportGroups } from "../services/error-report.service";
import { idParam, pageQuery, queryEnum, type PortalRouteDef } from "./portal-http";

export const ERROR_REPORT_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/hata-raporlari",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: { items: await errorReportSummary(prisma, { limit: pageQuery(c.req).limit }) } }),
  },
  {
    method: "get",
    path: "/hata-raporlari/:id",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: {
        items: await listErrorReportGroups(prisma, {
          installationDbId: idParam(c.req, "id", "Kurulum"),
          source: queryEnum(c.req, "kaynak", ERROR_REPORT_SOURCES),
          limit: pageQuery(c.req).limit,
        }),
      },
    }),
  },
];
