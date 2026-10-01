// İPTAL BELGESİ DEFTERİ (G4 §2.3) — satıcı iptal belgesini BASMAZ (yalnız kök imzalar, kök VDS'te yok): dönem
// töreninin paketinden İÇE AKTARIR, saklar ve dağıtır. Defter ekleme-yalnızdır (`iptal_belgesi`, tetikleyici);
// `sira` tekdüze artar ve yeni belge öncekinin bütün satırlarını taşır — iptal sessizce geri alınamaz.
// Dağıtım kapısı (`distributableRevocation`): bir HAK'ı ya da hâlâ yüklü bir imza anahtarını geçersiz kılacak
// belge, HAK yeniden basılıp anahtar emekliye ayrılmadan dağıtılmaz; o güne dek bir önceki belge dağıtılır.
import type { IptalBelgesi } from "@prisma/client";
import { parseJws, verifyRevocation, type RootKey, type VerifiedRevocation } from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { recordAudit } from "../lib/audit";
import { VendorError, stateConflict } from "../lib/errors";
import { lockKeySet } from "../lib/locks";
import { prisma, type Db } from "../lib/prisma";

export interface RevocationImportResult {
  readonly durum: "EKLENDI" | "VARDI";
  readonly sira: number;
  readonly iptalId: string;
  readonly kidler: readonly string[];
}

/** Belgeyi gömülü çapaya karşı doğrular; doğrulanamayan belge deftere GİRMEZ (400, protokol kodu). */
export function verifyRevocationToken(token: string, anchor: readonly RootKey[]): VerifiedRevocation {
  const v = verifyRevocation(token, anchor);
  if (!v.ok) throw new VendorError(400, v.code, `İptal belgesi doğrulanamadı (${v.code}): ${v.message}`);
  return v.value;
}

/**
 * Kök imzalı iptal belgesini deftere ekler (kilit altında): aynı belge tekrar gelirse VARDI (idempotent); aynı sıra
 * başka belgeyse, sıra eldekinden düşükse ya da önceki belgenin bir satırı düşmüşse 409 — sessiz geri alma yok.
 */
export async function importRevocation(g: { token: string; anchor: readonly RootKey[]; actor: string }): Promise<RevocationImportResult> {
  const verified = verifyRevocationToken(g.token, g.anchor);
  const doc = verified.document;
  const kidler = [...new Set(doc.iptaller.map((e) => e.kid))].sort();
  const result = await prisma.$transaction(async (tx) => {
    await lockKeySet(tx);
    const same = await tx.iptalBelgesi.findUnique({ where: { sira: doc.sira } });
    if (same) {
      if (same.belge !== g.token) throw stateConflict(`İptal sırası ${doc.sira} defterde BAŞKA bir belgeyle var — aynı sıra iki belge olamaz`);
      return { durum: "VARDI" as const, row: same };
    }
    const top = await tx.iptalBelgesi.findFirst({ orderBy: { sira: "desc" } });
    if (top && doc.sira < top.sira) throw stateConflict(`İptal sırası ${doc.sira} defterdeki en yüksek sıradan (${top.sira}) düşük`);
    if (top) {
      const prev = parseJws(top.belge);
      const prevEntries = prev.ok && Array.isArray(prev.value.payload.iptaller) ? (prev.value.payload.iptaller as { sertifikaId?: unknown; kid?: unknown }[]) : [];
      const kept = new Set(doc.iptaller.map((e) => e.sertifikaId));
      const dropped = prevEntries.filter((e) => typeof e.sertifikaId === "string" && !kept.has(e.sertifikaId)).map((e) => String(e.kid));
      if (dropped.length > 0) throw stateConflict(`Yeni iptal belgesi önceki belgenin satırlarını taşımıyor (${dropped.join(", ")}) — iptal sessizce geri alınamaz`);
    }
    const row = await tx.iptalBelgesi.create({
      data: { iptalId: doc.iptalId, sira: doc.sira, belge: g.token, imzalayanKid: verified.rootKid, verilis: new Date(doc.verilis), kidler, yukleyen: g.actor },
    });
    return { durum: "EKLENDI" as const, row };
  });
  if (result.durum === "EKLENDI") {
    await recordAudit({ event: "IPTAL_BELGESI_YUKLENDI", entity: "IptalBelgesi", entityId: result.row.id, actor: g.actor, summary: { sira: doc.sira, kidler } });
  }
  return { durum: result.durum, sira: doc.sira, iptalId: doc.iptalId, kidler };
}

export type RevocationBlocker =
  | { readonly tur: "HAK"; readonly hakId: string; readonly lisansNo: string; readonly surum: number; readonly kid: string }
  | { readonly tur: "ANAHTAR"; readonly kid: string };

export interface DistributableRevocation {
  /** Dağıtılacak belge (kira yanıtının `iptal` alanı; sırası kiranın `iptalSira`sı). Defter boşsa null. */
  readonly dagitilan: { readonly sira: number; readonly belge: string; readonly iptalId: string } | null;
  /** Defterde daha yüksek sıralı ama kapıda bekleyen belge (portal uyarısı). */
  readonly bekleyen: { readonly sira: number; readonly engeller: readonly RevocationBlocker[] } | null;
}

/** HAK belgesinin imzacısı ara imzacı mı (gömülü `imzaciSertifikasi`)? İmza burada doğrulanmaz — yalnız yük okunur. */
export function isIntermediateSignedToken(token: string): boolean {
  const p = parseJws(token);
  return p.ok && typeof p.value.payload.imzaciSertifikasi === "string";
}

/**
 * Belgenin engelleri: etkin bir HAK'ın DAĞITILABİLİR sürümü (güncel sürüm + eski derlemeye giden en yeni ara-dışı
 * sürüm) iptal edilen bir anahtarla imzalıysa ya da iptal edilen bir anahtar hâlâ anahtar dizininde yüklüyse.
 */
async function blockersOf(db: Db, keys: KeyStore, doc: VerifiedRevocation["document"]): Promise<RevocationBlocker[]> {
  const kids = [...new Set(doc.iptaller.map((e) => e.kid))];
  if (kids.length === 0) return [];
  const out: RevocationBlocker[] = [];
  const signedByRevoked = await db.hak.findMany({
    where: { aktif: true, guncelSurum: { gt: 0 }, surumler: { some: { imzalayanKid: { in: kids } } } },
    select: { id: true, lisansNo: true, guncelSurum: true, surumler: { orderBy: { surum: "desc" }, select: { surum: true, imzalayanKid: true, belge: true } } },
  });
  for (const hak of signedByRevoked) {
    const current = hak.surumler.find((v) => v.surum === hak.guncelSurum);
    const legacy = hak.surumler.find((v) => v.surum <= hak.guncelSurum && !isIntermediateSignedToken(v.belge));
    for (const v of [current, legacy]) {
      if (v && kids.includes(v.imzalayanKid) && !out.some((b) => b.tur === "HAK" && b.hakId === hak.id && b.surum === v.surum)) {
        out.push({ tur: "HAK", hakId: hak.id, lisansNo: hak.lisansNo, surum: v.surum, kid: v.imzalayanKid });
      }
    }
  }
  const revoked = (kid: string, usage: string) => doc.iptaller.some((e) => e.kid === kid && e.kullanim === usage);
  const loaded = [
    ...keys.subKeys.map((k) => ({ kid: k.kid, usage: k.kind as string })),
    ...keys.intermediates.map((k) => ({ kid: k.kid, usage: "HAK" })),
    ...keys.wrapped.filter((w) => w.kind === "BAYI").map((w) => ({ kid: w.kid, usage: "BAYI" })),
  ];
  for (const k of loaded) if (revoked(k.kid, k.usage)) out.push({ tur: "ANAHTAR", kid: k.kid });
  return out;
}

/**
 * Dağıtılacak iptal belgesi — tek kaynak (kira yanıtının `iptal` alanı ve kiranın `iptalSira`sı bundan dolar).
 * En yüksek sıradan aşağı: çapaya karşı doğrulanmayan satır atlanır, engeli olan belge beklemeye alınır; ilk
 * engelsiz belge dağıtılır. Böylece "HAK'ı geçersiz kılacak iptal, yeniden basılmış HAK olmadan dağıtılmaz".
 */
export async function distributableRevocation(db: Db, keys: KeyStore): Promise<DistributableRevocation> {
  const rows: IptalBelgesi[] = await db.iptalBelgesi.findMany({ orderBy: { sira: "desc" }, take: 16 });
  let waiting: DistributableRevocation["bekleyen"] = null;
  for (const row of rows) {
    const v = verifyRevocation(row.belge, keys.anchor);
    if (!v.ok) continue;
    const blockers = await blockersOf(db, keys, v.value.document);
    if (blockers.length === 0) return { dagitilan: { sira: row.sira, belge: row.belge, iptalId: row.iptalId }, bekleyen: waiting };
    waiting ??= { sira: row.sira, engeller: blockers };
  }
  return { dagitilan: null, bekleyen: waiting };
}

/** Portal: defter satırları (en yüksek sıra önce) + dağıtım kapısının durumu. Belge metni ayrıntıda değil listede yok. */
export async function revocationStatus(db: Db, keys: KeyStore) {
  const rows = await db.iptalBelgesi.findMany({ orderBy: { sira: "desc" }, take: 50, select: { id: true, iptalId: true, sira: true, imzalayanKid: true, verilis: true, kidler: true, yukleyen: true, createdAt: true } });
  const gate = await distributableRevocation(db, keys);
  return { belgeler: rows, dagitilanSira: gate.dagitilan?.sira ?? null, bekleyen: gate.bekleyen };
}
