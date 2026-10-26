// Kısa kimlik halkasının DB'deki İZİ: halkaya bağlı kid taşıyan satırlar (cihaz kanıt tuzu, PIN/kart
// özeti, `enc1:` TOTP sırrı). Halka dosyası yokken iz de yoksa ilk kurulum; iz varsa KAYIP — üretim
// sürer ama görünür olur (K-C5). Keyring senkron/önbellekli kalsın diye sorgu bu ayrı dosyadadır.
import prisma from "../prisma";
import { AuditService } from "../../services/audit.service";
import { uyari } from "../logger";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { getShortCredentialKeyRing, ringGeneratedThisProcessAt } from "./keyring";

export type FootprintSource = "cihazKaniti" | "pin" | "kart" | "totp";

/** kid → kaynak başına satır sayısı. */
export type RingFootprint = Map<string, Partial<Record<FootprintSource, number>>>;

export interface RingLoss {
  /** Kaybın görüldüğü an (bu süreçte halka üretildiyse üretim anı). */
  tespit: string;
  /** Halkada OLMAYAN ama DB'de izi duran kid'ler (anahtar içeriği değil). */
  kayipKidler: string[];
  /** Kaynak başına etkilenen satır sayısı. */
  etkilenen: Record<FootprintSource, number>;
}

const KID_RE = /^[0-9a-f]{16}$/;

/** DB'deki halka izi — dört kaynak, kid başına sayı (tek GROUP BY'lık okumalar, sıralı). */
export async function ringFootprint(): Promise<RingFootprint> {
  const out: RingFootprint = new Map();
  const add = (source: FootprintSource, rows: Array<{ kid: string | null; n: bigint }>) => {
    for (const r of rows) {
      if (!r.kid || !KID_RE.test(r.kid)) continue;
      const cur = out.get(r.kid) ?? {};
      cur[source] = (cur[source] ?? 0) + Number(r.n);
      out.set(r.kid, cur);
    }
  };
  add("cihazKaniti", await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>`
    SELECT split_part("proofSalt", ':', 1) AS kid, count(*) AS n FROM devices
     WHERE "proofSalt" IS NOT NULL GROUP BY 1`);
  add("pin", await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>`
    SELECT split_part("quickPinDigest", ':', 1) AS kid, count(*) AS n FROM users
     WHERE "quickPinDigest" IS NOT NULL GROUP BY 1`);
  add("kart", await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>`
    SELECT split_part("cardTokenDigest", ':', 1) AS kid, count(*) AS n FROM users
     WHERE "cardTokenDigest" IS NOT NULL GROUP BY 1`);
  add("totp", await prisma.$queryRaw<Array<{ kid: string | null; n: bigint }>>`
    SELECT split_part("totpSecret", ':', 2) AS kid, count(*) AS n FROM users
     WHERE "totpSecret" LIKE 'enc1:%' GROUP BY 1`);
  return out;
}

let firstSeenAt: string | null = null;

/**
 * Halka kaybı hükmü (sağlık, bildirim koşulu ve panelin TEK kaynağı). Halka kullanılamıyorsa
 * null — o durum ayrı sorundur (`key.ok=false`), kayıp sayılmaz. `footprint` yalnız bekçi içindir
 * (paylaşılan test DB'sinde "iz yok" ilk kurulumu kurulamaz).
 */
export async function evaluateRingLoss(footprint?: RingFootprint): Promise<RingLoss | null> {
  const st = getShortCredentialKeyRing();
  if (!st.ok) return null;
  const ringKids = new Set(st.ring.keys.map((k) => k.kid));
  const fp = footprint ?? (await ringFootprint());
  const etkilenen: Record<FootprintSource, number> = { cihazKaniti: 0, pin: 0, kart: 0, totp: 0 };
  const kayipKidler: string[] = [];
  for (const [kid, bySource] of [...fp.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ringKids.has(kid)) continue;
    kayipKidler.push(kid);
    for (const [s, n] of Object.entries(bySource) as Array<[FootprintSource, number]>) etkilenen[s] += n;
  }
  if (kayipKidler.length === 0) {
    firstSeenAt = null;
    return null;
  }
  firstSeenAt ??= new Date().toISOString();
  return { tespit: ringGeneratedThisProcessAt() ?? firstSeenAt, kayipKidler, etkilenen };
}

/** Halkada olmayan kid'lerin kümesi (proof-lost listesi; halka kullanılamıyorsa null). */
export function ringKidSet(): Set<string> | null {
  const st = getShortCredentialKeyRing();
  return st.ok ? new Set(st.ring.keys.map((k) => k.kid)) : null;
}

let bootNoted = false;

/**
 * Boot'ta BİR KEZ: halka bu süreçte ÜRETİLDİ ve DB'de eski iz var → kayıp olayı audit'e (yalnız kid
 * listesi + sayılar) ve log'a. İz yoksa (ilk kurulum) hiçbir şey yazılmaz. Döner: hüküm.
 */
export async function noteRingLossOnBoot(footprint?: RingFootprint): Promise<RingLoss | null> {
  if (bootNoted || ringGeneratedThisProcessAt() === null) return null;
  const loss = await evaluateRingLoss(footprint);
  bootNoted = true;
  if (!loss) return null;
  uyari(
    "kisa-kimlik",
    `anahtar halkası KAYIP: halka yeniden üretildi, ${loss.kayipKidler.length} eski anahtarın izi duruyor ` +
      `(${loss.etkilenen.cihazKaniti} cihaz kanıtı, ${loss.etkilenen.pin} PIN, ${loss.etkilenen.kart} kart, ${loss.etkilenen.totp} TOTP) — ` +
      `yedekten anahtar emanetini geri yükleyin (${ekranYolu("kisaKimlikler")}) ya da ${ekranYolu("tabletler")} ` +
      "sayfasındaki \"Anahtar kaybı\" bandından cihazları yeniden bağlayın.",
  );
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "SHORT_CREDENTIAL_RING_LOST",
    payload: { kayipKidler: loss.kayipKidler, etkilenen: loss.etkilenen, tespit: loss.tespit },
  });
  return loss;
}

// Cihaz ara katmanının "HALKA" hükmü (tuzun kid'i halkada yok / halka okunamadı) — süreç sayacı, sağlığa gider.
let halkaVerdicts = 0;
let lastHalkaVerdictAt: string | null = null;

export function noteHalkaVerdict(): void {
  halkaVerdicts += 1;
  lastHalkaVerdictAt = new Date().toISOString();
}

export function halkaVerdictStats(): { sayi: number; son: string | null } {
  return { sayi: halkaVerdicts, son: lastHalkaVerdictAt };
}

/** Yalnız bekçi: boot işaretini ve sayacı sıfırlar. */
export function resetRingLossStateForTests(): void {
  bootNoted = false;
  firstSeenAt = null;
  halkaVerdicts = 0;
  lastHalkaVerdictAt = null;
}
