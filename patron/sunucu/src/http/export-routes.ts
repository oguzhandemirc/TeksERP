// Dışa aktarma rotaları (Ek-6/A §4.2) — hesap API'si tablosunun parçası (`API_ROUTES`e yayılır). Yalnız hesap
// yöneticisi; hizmet açıkken ve bittikten sonraki 90 gün (salt okuma) açık. Dosya ek olarak iner (`no-store`).
import { exportManifest, openExport, parseExportFormat } from "../services/export.service";
import { s, type ApiRouteDef } from "./api-route-kit";

export const EXPORT_ROUTES: readonly ApiRouteDef[] = [
  { method: "get", path: "/disa-aktar", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await exportManifest(c.ctx, s(c)) }) },
  {
    method: "get",
    path: "/disa-aktar/:kume",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => ({ file: await openExport(c.ctx, s(c), String(c.req.params.kume), parseExportFormat(c.req.query.bicim)) }),
  },
];
