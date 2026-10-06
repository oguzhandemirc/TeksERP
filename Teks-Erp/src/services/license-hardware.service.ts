// Donanım değişikliği bildirimi (K8): panelin "Donanım değişikliğini bildir" düğmesi → parmak izi YENİDEN ölçülür
// (değişiklik az önce yapılmış olabilir) → ölçülen küme (≤ 24 sa önbellek dahil) + kayıp etkenler + gerekçe imzalı
// `amac: donanim` isteğiyle satıcıya (`POST /v1/donanim`). Güçlü etkenler (F2 · F3 · F4) tutuyorsa satıcı yeni kümeyi
// kendiliğinden öğrenir ve kira döner (burada her kira gibi doğrulanıp kabul edilir); tutmuyorsa talep portal onay
// kuyruğuna düşer. Uç her lisans kademesinde açıktır (`/api/license/*` kurtarma yolu).
import { AppError } from "../utils/app-error";
import {
  ENDPOINTS,
  HardwareReportRequestSchema,
  HardwareReportResponseSchema,
  type FingerprintFactor,
  type HardwareReportRequest,
  type HardwareReportState,
} from "../lib/license/protocol";
import { adminAction } from "./license-trail.service";
import { acceptLicenseResponse, refreshLicenseFingerprint, runLeaseExchange } from "./license-sync.service";
import { getLicenseDetail, type LicenseDetail } from "./license-view.service";
import {
  currentFingerprintDigest,
  currentLostFactors,
  egressTransport,
  invalidResponse,
  liveArrival,
  requireLicenseId,
  requireReady,
  requireVendorUrl,
  vendorFailureToError,
  vendorPost,
  type VendorTransport,
} from "./helpers/license-wire.helper";

export interface LicenseHardwareReportResult {
  readonly talepId: string;
  readonly durum: HardwareReportState;
  /** Bildirimde kayıp sayılan etkenler (kabul kümesinde değeri olup 24 sa hiçbir yoldan okunamayan). */
  readonly kayip: readonly FingerprintFactor[];
  readonly lisans: LicenseDetail;
}

/** Bildirim gövdesi — çevrimiçi uç ve çevrimdışı zarf AYNI kurucudan: ölçülen küme + kayıp etkenler + gerekçe. */
export function buildHardwareReportBody(gerekce: string | null): HardwareReportRequest {
  return HardwareReportRequestSchema.parse({ v: 1, parmakIzi: currentFingerprintDigest(), kayip: currentLostFactors(), gerekce });
}

export async function sendHardwareReport(
  gerekce: string | null,
  transport: VendorTransport,
  userId: string | null = null,
): Promise<{ durum: HardwareReportState; talepId: string; kayip: FingerprintFactor[] }> {
  const body = buildHardwareReportBody(gerekce);
  const lostFactors = [...body.kayip];
  const r = await vendorPost(ENDPOINTS.HARDWARE, "donanim", body, transport);
  if (!r.ok) throw vendorFailureToError(r);
  const parsed = HardwareReportResponseSchema.safeParse(r.json);
  if (!parsed.success) throw invalidResponse("Donanım bildirimi yanıtı biçimsiz.");
  const h = parsed.data;
  if (h.durum === "ONAYLANDI" && h.lisans) await acceptLicenseResponse(h.lisans, "donanim", liveArrival(r), userId);
  return { durum: h.durum, talepId: h.talepId, kayip: lostFactors };
}

/** Etkinleşmiş kurulum ister (bildirim lisans kimliğiyle imzalanır); ayak izi başarıda ve retde. */
export async function reportHardwareChange(gerekce: string | null, userId: string | null, transport: VendorTransport = egressTransport): Promise<LicenseHardwareReportResult> {
  requireLicenseId(requireReady());
  requireVendorUrl();
  await refreshLicenseFingerprint();
  try {
    const r = await runLeaseExchange(() => sendHardwareReport(gerekce, transport, userId));
    adminAction(userId, "donanim-bildir", { talepId: r.talepId, sonuc: r.durum, kayip: r.kayip });
    return { talepId: r.talepId, durum: r.durum, kayip: r.kayip, lisans: getLicenseDetail() };
  } catch (err) {
    adminAction(userId, "donanim-bildir", { sonuc: err instanceof AppError ? String(err.details?.vendorCode ?? err.details?.code ?? "RED") : "RED" });
    throw err;
  }
}
