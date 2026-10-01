// İptal belgesinin DB KOPYASI (G4, ayrılmış ayar `license.revocation`) — okuması, TEK yazıcısı ve benimsemenin ayak izi.
// Karar `lib/license/revocation-store.ts`te; audit yalnız GERÇEK benimsemede yazılır (onarımda değil) ve karar kaynağı değildir.
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { uyari } from "../lib/logger";
import { LICENSE_REVOCATION_SETTING_KEY } from "../constants/reserved-settings";
import { getLicenseConfig, getLicenseSnapshot } from "../lib/license/runtime";
import {
  acknowledgeRevocationWrite,
  adoptRevocation,
  markRevocationRowUnknown,
  newerRevocation,
  registerRevocationWriter,
  repairRevocationCopies,
  revocationHolding,
  revocationSira,
  revokesCertificate,
  setRevocationRow,
  verifyHeldRevocation,
  type HeldRevocation,
  type RevocationRow,
} from "../lib/license/revocation-store";

/** Satırı okur (açılış + saatlik) ve eksik/düşük kopyayı onarır; DB okunamazsa kopya BİLİNMİYOR (kayıp üretmez). */
export async function refreshLicenseRevocation(): Promise<void> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LICENSE_REVOCATION_SETTING_KEY }, select: { value: true } });
    setRevocationRow(row ? row.value : null);
  } catch {
    markRevocationRowUnknown();
    return;
  }
  repairRevocationCopies(getLicenseConfig().roots);
}

async function writeRevocationRow(row: RevocationRow): Promise<void> {
  try {
    await prisma.systemSetting.upsert({
      where: { key: LICENSE_REVOCATION_SETTING_KEY },
      create: { key: LICENSE_REVOCATION_SETTING_KEY, value: row, description: "Lisans iptal belgesi (kopya) — yalnız lisans motoru yazar" },
      update: { value: row },
    });
    acknowledgeRevocationWrite(row);
  } catch (err) {
    acknowledgeRevocationWrite(null);
    uyari("lisans", "iptal belgesi DB'ye yazılamadı (dosya kopyası geçerli)", err instanceof Error ? err.message : err);
  }
}
registerRevocationWriter(writeRevocationRow);

/** Yanıttaki iptal belgesi ile eldekinin seçimi: gelen çekirdekte doğrulanır, doğrulanamayan yok sayılır (kirayı düşürmez). */
export interface RevocationOffer {
  readonly held: HeldRevocation | null;
  readonly incoming: HeldRevocation | null;
  /** Kira ve HAK bununla doğrulanır: yüksek sıralı olan. */
  readonly picked: HeldRevocation | null;
}

export function revocationOffer(incomingJws: string | undefined): RevocationOffer {
  const roots = getLicenseConfig().roots;
  const held = revocationHolding(roots).effective;
  const incoming = incomingJws === undefined ? null : verifyHeldRevocation(incomingJws, roots);
  return { held, incoming, picked: newerRevocation(held, incoming) };
}

/** Seçilen belge eldekinden yeniyse iki kopyaya yazılır; ayak izi yalnız gerçek benimsemede. */
export function adoptOffered(offer: RevocationOffer, source: string): void {
  const picked = offer.picked;
  if (!picked || revocationSira(picked) <= revocationSira(offer.held)) return;
  const r = adoptRevocation(picked.jws, getLicenseConfig().roots);
  if (!r.adopted) return;
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "LICENSE_REVOCATION_ADOPTED",
    payload: { sira: r.sira, kayitSayisi: r.kayitSayisi, kaynak: source },
  });
}

/**
 * Reddedilen yanıttaki iptal belgesi: kök imzalı ve eldekinden yüksek sıralıysa benimsenir — ama eldeki kullanılabilir
 * kiranın ALT sertifikasını iptal ediyorsa ERTELENİR (iptal mevcut geçerli kirayı anında öldürmez; yeni kirayla gelir).
 */
export function adoptFromRejected(offer: RevocationOffer, source: string): void {
  const lease = getLicenseSnapshot().lease;
  if (!offer.incoming || (lease && revokesCertificate(offer.incoming, lease.subCertificate.document))) return;
  adoptOffered({ ...offer, picked: newerRevocation(offer.held, offer.incoming) }, source);
}
