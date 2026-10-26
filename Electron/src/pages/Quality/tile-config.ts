// Kalite Güvence kökü (`/quality`) karoları — UX-2 K1: Operasyon'dan taşındı, kopya karo açılmaz; sıra = hub sırası.
import { FlaskConical, BadgeCheck, Gauge, ScanSearch, FileText } from "lucide-react";
import type { OperationsTile } from "@/pages/Operations/tile-config";
import { flagOffHint } from "@/lib/flag-setting-path";

/** Kalite Güvence karosu: Operasyon karosuyla aynı biçim, grup alanı yok (tek bölüm). */
export type QualityTile = Omit<OperationsTile, "group">;

/** Kalite Güvence kapalıyken karoların ortak mesajı — yol ayar kaydından (`flagOffHint`), elle yazılmaz. */
export const KALITE_GUVENCE_OFF_HINT = flagOffHint("kaliteGuvenceEnabled");

export const qualityTiles: QualityTile[] = [
  {
    key: "inspections",
    title: "Muayeneler",
    description: "4 puan muayeneleri — puan / 100 m², derece önerisi, düzelt ve iptal",
    icon: ScanSearch,
    to: "/quality/inspections",
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
    permission: "inspection:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
  {
    // UX-2 (ENVANTER B6): rapor yalnız palette ve sevkiyat detayındaydı; seçici modal doğrudan açılır.
    key: "inspection-report",
    title: "Muayene Raporu",
    description: "Sevk toplarının 4 puan muayene raporu — sevkiyat seç, PDF veya Excel al",
    icon: FileText,
    to: "/quality/inspections?report=1",
    permission: "inspection:read",
    visibleWhen: (ctx) => ctx.kaliteGuvenceEnabled,
    offHint: KALITE_GUVENCE_OFF_HINT,
  },
];
