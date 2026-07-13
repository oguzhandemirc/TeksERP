// =============================================================================
// "Her yerde okut" çözümleyici kayıt — tür → backend lookup + sekme aksiyonları
// =============================================================================
// Global wedge bir kod yakalayınca overlay bu modülü çağırır: doğru ucu vurur,
// varlık özetini ve gidilebilecek sekmeleri (openTab hedefleri) döndürür. Lookup
// uçları doğrulanmış (route'lar mevcut). Toast bastırılır — mesajı overlay yönetir.
// Hedef sayfalar `useScanSeed` ile location.state'ten kodu okuyup oto-aksiyon alır.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { BarcodeKind } from "@/lib/scanner/barcode-kind";

export interface ScanAction {
  label: string;
  to: string;
  state?: unknown;
  primary?: boolean;
}

export interface ScanResolution {
  kind: BarcodeKind;
  code: string;
  found: boolean;
  title: string;
  subtitle?: string;
  note?: string;
  actions: ScanAction[];
}

const cfg = { suppressErrorToast: true } as const;

function joinDot(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== "").join(" · ");
}

async function resolveRoll(code: string): Promise<ScanResolution> {
  const res = await apiClient
    .get<ApiResponse<Record<string, unknown>>>(`/api/rolls/barcode/${encodeURIComponent(code)}`, cfg)
    .then((r) => r.data);
  const roll = (res.data ?? {}) as Record<string, unknown>;
  const item = roll.item as { name?: string } | undefined;
  const color = roll.color as { name?: string } | undefined;
  return {
    kind: "ROLL",
    code,
    found: true,
    title: (roll.barcode as string) ?? code,
    subtitle: joinDot([
      item?.name,
      color?.name,
      roll.width ? `${roll.width as number} cm` : null,
      roll.status as string,
    ]),
    actions: [
      { label: "Detayı aç (Envanter)", to: "/operations/rolls", state: { scanBarcode: code }, primary: true },
      { label: "Çuval Deposu'nda bul / düzenle", to: "/operations/sack-content-edit", state: { scanCode: code } },
      { label: "Yeniden Etiketle", to: "/operations/relabel-station", state: { scanCode: code } },
    ],
  };
}

async function resolveTravelerCard(code: string): Promise<ScanResolution> {
  const res = await apiClient
    .get<ApiResponse<Record<string, unknown>>>(
      `/api/traveler-cards/by-barcode/${encodeURIComponent(code)}`,
      cfg,
    )
    .then((r) => r.data);
  const card = (res.data ?? {}) as Record<string, unknown>;
  const wo = card.workOrder as { id?: string; batchNumber?: string } | undefined;
  const woId = (card.workOrderId as string) ?? wo?.id;
  return {
    kind: "TRAVELER_CARD",
    code,
    found: true,
    title: (card.cardNumber as string) ?? code,
    subtitle: joinDot(["Refakat Kartı", wo?.batchNumber, card.status as string]),
    actions: woId
      ? [{ label: "İş Emrini Aç", to: `/operations/work-orders/${woId}`, primary: true }]
      : [],
  };
}

async function resolveSwatch(code: string): Promise<ScanResolution> {
  const res = await apiClient
    .get<ApiResponse<Record<string, unknown>>>(
      `/api/swatches/by-barcode/${encodeURIComponent(code)}`,
      cfg,
    )
    .then((r) => r.data);
  const sw = (res.data ?? {}) as Record<string, unknown>;
  const item = sw.item as { name?: string } | undefined;
  const color = sw.color as { name?: string } | undefined;
  return {
    kind: "SWATCH",
    code,
    found: true,
    title: (sw.cardNumber as string) ?? code,
    subtitle: joinDot(["Kartela", item?.name, color?.name]),
    actions: [{ label: "Kartela Takibi'nde aç", to: "/operations/kartela", state: { scanCode: code }, primary: true }],
  };
}

interface SackRow {
  sackNo?: string;
  shipment?: { shipmentNo?: string; status?: string; customer?: { name?: string } };
}

const SACK_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

/**
 * Duruma göre TEK akıllı birincil hedef (operatörün karar yükünü düşür):
 * Depoda (sevkiyata atanmamış, status yok) → Çuval Deposu (içerik orada düzenlenir);
 * PLANNED → Sevk Kapısı (sevk çıkışı orada), DISPATCHED → yalnız Çuval
 * Deposu araması (içerik kilitli). Arama + Paketleme tek hub'da birleşti.
 */
function sackActions(code: string, status: string | undefined): ScanAction[] {
  const hub: ScanAction = {
    label: "Çuval Deposu'nda aç (bul / düzenle)",
    to: "/operations/sack-content-edit",
    state: { scanCode: code },
  };
  const store: ScanAction = {
    label: "Sevk Kapısı'nda aç",
    to: "/operations/sack-store",
    state: { scanCode: code },
  };
  // Depodaki çuval — henüz bir sevkiyata atanmamış (status yok).
  if (!status) {
    return [{ ...hub, primary: true }];
  }
  switch (status) {
    case "PLANNED":
      return [{ ...store, primary: true }, hub];
    case "DISPATCHED":
      // Hub'a özel seed: sackCode filtresi + "sevk edilmişleri de ara" birlikte
      // açılır — yoksa varsayılan kapsam sevk edilmişi gizler, liste boş görünür.
      return [
        {
          label: "Çuval Deposu'nda aç (sevk edilmiş)",
          to: "/operations/sack-content-edit",
          state: { scanCodeDispatched: code },
          primary: true,
        },
      ];
    default:
      // Bilinmeyen statü (CANCELLED vb.) → güvenli evrensel hedef: hub.
      return [{ ...hub, primary: true }];
  }
}

async function resolveSackByCode(code: string, kind: BarcodeKind): Promise<ScanResolution> {
  const res = await apiClient
    .get<{ data: SackRow[] }>(
      `/api/shipping/sack-search?sackCode=${encodeURIComponent(code)}&includeDispatched=true`,
      cfg,
    )
    .then((r) => r.data);
  const rows = res.data ?? [];
  const first = rows[0];
  if (!first) {
    return notFound(kind, code);
  }
  const status = first.shipment?.status;
  return {
    kind: "SACK",
    code,
    found: true,
    title: first.sackNo ?? code,
    subtitle: joinDot([
      rows.length > 1 ? `${rows.length} eşleşme` : null,
      status ? SACK_STATUS_LABEL[status] : null,
      first.shipment?.shipmentNo,
      first.shipment?.customer?.name,
    ]),
    note: status === "DISPATCHED" ? "Sevk edilmiş — içerik kilitli." : undefined,
    actions: sackActions(code, status),
  };
}

function notFound(kind: BarcodeKind, code: string): ScanResolution {
  const actions: ScanAction[] = [];
  if (kind === "ROLL") {
    actions.push({ label: "Yeniden Etiketle'de dene", to: "/operations/relabel-station", state: { scanCode: code } });
  }
  return {
    kind,
    code,
    found: false,
    title: code,
    note: "Bu kodla eşleşen kayıt bulunamadı.",
    actions,
  };
}

/** Bekleyen scan'i çöz. Hata (404 vb.) → "bulunamadı" sonucu (overlay mesajı yönetir). */
export async function resolveScan(kind: BarcodeKind, code: string): Promise<ScanResolution> {
  try {
    switch (kind) {
      case "ROLL":
        return await resolveRoll(code);
      case "TRAVELER_CARD":
        return await resolveTravelerCard(code);
      case "SWATCH":
        return await resolveSwatch(code);
      case "SACK":
        return await resolveSackByCode(code, "SACK");
      case "DISPATCH_DOC":
        return {
          kind,
          code,
          found: true,
          title: code,
          subtitle: "Fason/Kartela sevk-kabul belgesi",
          note: "Bu belge için ayrı bir detay ekranı yok.",
          actions: [],
        };
      case "UNKNOWN":
      default:
        // Tek tip kod kalıbı: bilinmeyen prefix = eşleşme yok.
        return notFound(kind, code);
    }
  } catch {
    return notFound(kind, code);
  }
}
