// Operasyon › Kalite Güvence karoları (sıra = hub sırası).
import { FlaskConical, BadgeCheck, Gauge, ScanSearch } from "lucide-react";
import type { OperationsTile } from "../tile-config";

/** Kalite Güvence kapalıyken karoların ortak mesajı (Raporlar v2 kapalı mesajı emsali). */
export const KALITE_GUVENCE_OFF_HINT = "Kalite Güvence kapalı — Genel Ayarlar'dan açılır";

export const qualityTiles: OperationsTile[] = [
  {
    key: "inspections",
    title: "Muayeneler",
    description: "4 puan muayeneleri — puan / 100 m², derece önerisi, düzelt ve iptal",
    icon: ScanSearch,
    to: "/quality/inspections",
    group: "quality",
    permission: "inspection:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
  {
    key: "lab-tests",
    title: "Lab Testleri",
    description: "Numune sonuçları — gramaj, haslık, çekme; onaylanan test donar",
    icon: FlaskConical,
    to: "/quality/lab-tests",
    group: "quality",
    permission: "labtest:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
  {
    key: "certificates",
    title: "Sertifikalar",
    description: "OEKO-TEX, GOTS… bitiş takibi; müşteri spesifikasyonları",
    icon: BadgeCheck,
    to: "/quality/certificates",
    group: "quality",
    permission: "certificate:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
  {
    key: "inspection-rules",
    title: "4 Puan Kuralları",
    description: "Puan aralığı → kalite derecesi; fabrika varsayılanı ve müşteri spesifikasyonları",
    icon: Gauge,
    to: "/quality/inspection-rules",
    group: "quality",
    permission: "inspection:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
];
