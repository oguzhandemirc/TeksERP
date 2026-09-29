import { licenseService } from "@/services/licenseService";
import type { LicenseDetail, OfflinePurpose } from "@/types/license";
import type { LicenseRelayFailure } from "@shared/license-relay";

/** Otomatik aktarma ritmi — backend'in saatlik yoklamasından sık, satıcıyı yormayacak kadar seyrek. */
export const LICENSE_RELAY_INTERVAL_MS = 15 * 60_000;

/**
 * Backend satıcıya ÇIKAMIYOR mu — otomatik panel aktarmasının TEK kararı.
 *
 * Backend bugün bunu adlı bir alanla bildirmiyor; karar `detay.yoklama`dan
 * okunur: son yoklama denemesi ağ katmanında (`EGRESS_*`) düştüyse ve ondan
 * sonra başarı yoksa. Etkin olmayan kurulum otomatik aktarılmaz (etkinleştirme
 * kod ister, yöneticinin eylemidir); bekleyen taşıma çevrimdışı uçtan geçmez.
 */
export function shouldAutoRelay(d: Pick<LicenseDetail, "kurulum" | "yoklama" | "tasima">): boolean {
  const y = d.yoklama;
  if (!d.kurulum.etkin || !y.saticiYapilandirildi || d.tasima) return false;
  if (!y.sonHataKodu?.startsWith("EGRESS_") || !y.sonBasarisizlik) return false;
  return !y.sonBasari || Date.parse(y.sonBasarisizlik) > Date.parse(y.sonBasari);
}

const FAILURE_TEXT: Record<LicenseRelayFailure, string> = {
  HEDEF_GECERSIZ: "Lisans sunucusu adresi aktarmaya uygun değil.",
  GOVDE_GECERSIZ: "Aktarılacak istek biçimsiz.",
  AG_HATASI: "Bu bilgisayar da lisans sunucusuna ulaşamadı.",
  ZAMAN_ASIMI: "Lisans sunucusu zamanında cevap vermedi.",
  YANIT_BUYUK: "Lisans sunucusunun yanıtı beklenenden büyük.",
  YANIT_JSON_DEGIL: "Lisans sunucusunun yanıtı okunamadı.",
};

export type RelayOutcome = { ok: true; detail: LicenseDetail } | { ok: false; message: string };

/** Satıcının hata gövdesinden cümle — biçim `{ success:false, message, details:{code} }`. */
function vendorMessage(yanit: unknown, status: number): string {
  const m = (yanit as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : `Lisans sunucusu isteği reddetti (HTTP ${status}).`;
}

/** Bu panelde aktarma yapılabilir mi (masaüstü uygulaması; web panelinde köprü yok). */
export function canRelay(): boolean {
  return typeof window !== "undefined" && typeof window.api?.license?.relay === "function";
}

/**
 * Backend'in imzaladığı isteği satıcıya taşır, yanıtı backend'e verir. Panel
 * sır görmez: istek kurulum, yanıt satıcı anahtarıyla imzalı; backend doğrular.
 */
export async function relayViaPanel(amac: OfflinePurpose, kod?: string): Promise<RelayOutcome> {
  if (!canRelay()) return { ok: false, message: "Aktarma yalnız masaüstü uygulamasında yapılabilir." };
  const req = await licenseService.relayRequest(amac, kod);
  if (!req.hedefUrl) return { ok: false, message: "Lisans sunucusu adresi tanımlı değil." };
  const r = await window.api.license.relay({ hedefUrl: req.hedefUrl, istekGovdesi: req.istekGovdesi });
  if (!r.ok) return { ok: false, message: FAILURE_TEXT[r.kod] };
  if (r.status < 200 || r.status >= 300) return { ok: false, message: vendorMessage(r.yanit, r.status) };
  const detail = await licenseService.relayResponse(r.yanit);
  return { ok: true, detail };
}
