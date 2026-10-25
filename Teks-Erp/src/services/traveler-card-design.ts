// =============================================================================
// Refakat kartı ↔ tasarımcı şablonu (P-e, T11) — kart DONMAZ, tasarım canlı çözülür
// =============================================================================
// Karar `resolvePrintPlan`da tek noktada verilir; bu modül yalnız İZ (`designTemplate`)
// yazar ve kartı yayındaki sürümle basar. İz içerik değildir: `planKey` onu atar.
// =============================================================================

import { envelopeHead } from "./document-render/envelope-head";
import type { TravelerCardMeta, TravelerCardSnapshot } from "./document-render/traveler-card.html";
import type { TravelerPageSize } from "./document-render/traveler-card.density";
import { type LiveTemplate, liveWatermark, renderLiveTemplate } from "./document-template/live-binding";
import type { FrozenTemplateRef } from "./document-template/print-binding";

/** Kart snapshot'ı + tasarım izi (yalnız bayrak açık ve varsayılan yayındayken). */
export type DesignedCardSnapshot = TravelerCardSnapshot & { designTemplate?: FrozenTemplateRef };

/** Eski izi her zaman düşürür, yalnız GÜNCEL tasarımı yazar — arşiv izi geri taşınmaz. */
export function withDesign(base: TravelerCardSnapshot, design: LiveTemplate | null): DesignedCardSnapshot {
  const out: DesignedCardSnapshot = { ...base };
  delete out.designTemplate;
  if (design) out.designTemplate = { ...design.ref };
  return out;
}

const PRINT_STATUS: Record<string, "ACTIVE" | "VOIDED" | "SUPERSEDED"> = { VOIDED: "VOIDED", REPRINTED: "SUPERSEDED" };

/** Yayındaki sürümle kart HTML'i; `pageSize` tek seferlik ezme, yalnız ayar kopyasına biner. */
export function renderCardDesign(design: LiveTemplate, snapshot: TravelerCardSnapshot, meta: TravelerCardMeta, pageSize?: TravelerPageSize): string {
  const card: Record<string, unknown> = { ...snapshot };
  for (const k of ["config", "template", "designTemplate"]) delete card[k];
  const { qrSvg: _qr, draft: _draft, status, ...metaRest } = meta;
  return renderLiveTemplate("TRAVELER_CARD", design, {
    source: { card, meta: metaRest, ...envelopeHead() },
    settingsOverlay: pageSize ? { pageSize } : undefined,
    baski: {
      surum: meta.version,
      durum: PRINT_STATUS[status ?? ""] ?? "ACTIVE",
      taslak: meta.draft === true,
      iptalNedeni: meta.voidReason ?? null,
      zaman: new Date().toISOString(),
    },
    watermark: liveWatermark(status, meta.draft === true),
  });
}
