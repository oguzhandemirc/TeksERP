// DAĞITIM İPTALİ DEFTERİ (`tekserp-paketiptal`; PAKET-ANAHTARI-KOK-ALTINDA §2.4, ISTEMCI-ANAHTARI-KOK-ALTINDA §3.4) — satıcı
// belgeyi BASMAZ (yalnız kök imzalar): tören paketinden İÇE AKTARIR, saklar ve her kira yanıtına (`paketIptal`) koyar.
// Defter ekleme-yalnızdır (`paket_iptal_belgesi`, tetikleyici); `sira` tekdüze artar, yeni belge öncekinin bütün
// satırlarını taşır. Dağıtım kapısı YOK: satıcı PAKET/ISTEMCI anahtarı tutmaz, imzaladığı hiçbir şey bu belgeyle düşmez.
import { isPackageCertificateRevoked, parseJws, verifyPackageRevocation, type RootKey, type VerifiedPackageRevocation } from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { recordAudit } from "../lib/audit";
import { VendorError, stateConflict } from "../lib/errors";
import { lockKeySet } from "../lib/locks";
import { prisma, type Db } from "../lib/prisma";

export interface PackageRevocationImportResult {
  readonly durum: "EKLENDI" | "VARDI";
  readonly sira: number;
  readonly iptalId: string;
  readonly kidler: readonly string[];
}

/** Kök çapasına karşı doğrular; doğrulanamayan belge deftere GİRMEZ (400, protokol kodu). */
export function verifyPackageRevocationToken(token: string, anchor: readonly RootKey[]): VerifiedPackageRevocation {
  const v = verifyPackageRevocation(token, anchor);
  if (!v.ok) throw new VendorError(400, v.code, `Dağıtım iptal belgesi doğrulanamadı (${v.code}): ${v.message}`);
  return v.value;
}

/** Defterdeki belgenin satırları (kid + sertifika kimliği); okunamayan belge null — çağıran KAPALI düşer. */
function rowsOf(token: string): { kid: string; sertifikaId: string }[] | null {
  const p = parseJws(token);
  if (!p.ok || !Array.isArray(p.value.payload.iptaller)) return null;
  const out: { kid: string; sertifikaId: string }[] = [];
  for (const e of p.value.payload.iptaller as { kid?: unknown; sertifikaId?: unknown }[]) {
    if (typeof e?.kid !== "string" || typeof e.sertifikaId !== "string") return null;
    out.push({ kid: e.kid, sertifikaId: e.sertifikaId });
  }
  return out;
}

/**
 * Kök imzalı dağıtım iptalini deftere ekler (anahtar kümesi kilidi altında): aynı belge tekrar gelirse VARDI; aynı sıra
 * başka belgeyse, sıra eldekinden düşükse, iptal kimliği başka sırada kullanılmışsa ya da önceki belgenin bir satırı
 * (kid + sertifika kimliği çifti) düşmüşse 409 — iptal sessizce geri alınamaz.
 */
export async function importPackageRevocation(g: { token: string; anchor: readonly RootKey[]; actor: string }): Promise<PackageRevocationImportResult> {
  const verified = verifyPackageRevocationToken(g.token, g.anchor);
  const doc = verified.document;
  const kidler = [...new Set(doc.iptaller.map((e) => e.kid))].sort();
  const result = await prisma.$transaction(async (tx) => {
    await lockKeySet(tx);
    const same = await tx.paketIptalBelgesi.findUnique({ where: { sira: doc.sira } });
    if (same) {
      if (same.belge !== g.token) throw stateConflict(`Dağıtım iptali sırası ${doc.sira} defterde BAŞKA bir belgeyle var — aynı sıra iki belge olamaz`);
      return { durum: "VARDI" as const, row: same };
    }
    const top = await tx.paketIptalBelgesi.findFirst({ orderBy: { sira: "desc" } });
    if (top && doc.sira < top.sira) throw stateConflict(`Dağıtım iptali sırası ${doc.sira} defterdeki en yüksek sıradan (${top.sira}) düşük`);
    const sameId = await tx.paketIptalBelgesi.findUnique({ where: { iptalId: doc.iptalId } });
    if (sameId) throw stateConflict(`Dağıtım iptali kimliği ${doc.iptalId} defterde sıra ${sameId.sira} ile var — yeni belge yeni kimlik taşır`);
    if (top) {
      const prev = rowsOf(top.belge);
      if (!prev) throw new VendorError(500, "SUNUCU_HATASI", `Defterdeki dağıtım iptali (sıra ${top.sira}) okunamadı — satır karşılaştırması yapılamadan yeni belge eklenmez`);
      const kept = new Set(doc.iptaller.map((e) => `${e.kid}\u0000${e.sertifikaId}`));
      const dropped = prev.filter((e) => !kept.has(`${e.kid}\u0000${e.sertifikaId}`)).map((e) => e.kid);
      if (dropped.length > 0) throw stateConflict(`Yeni dağıtım iptali önceki belgenin satırlarını taşımıyor (${dropped.join(", ")}) — iptal sessizce geri alınamaz`);
    }
    const row = await tx.paketIptalBelgesi.create({
      data: { iptalId: doc.iptalId, sira: doc.sira, belge: g.token, imzalayanKid: verified.rootKid, verilis: new Date(doc.verilis), kidler, yukleyen: g.actor },
    });
    return { durum: "EKLENDI" as const, row };
  });
  if (result.durum === "EKLENDI") {
    await recordAudit({ event: "PAKET_IPTAL_BELGESI_YUKLENDI", entity: "PaketIptalBelgesi", entityId: result.row.id, actor: g.actor, summary: { sira: doc.sira, kidler } });
  }
  return { durum: result.durum, sira: doc.sira, iptalId: doc.iptalId, kidler };
}

/**
 * Kira yanıtının `paketIptal`i — TEK seçim noktası (yalnız `licenseResponse` çağırır): çapaya karşı doğrulanan en yüksek
 * sıralı belge, HER kuruluma (yetenek kapısı yok: yanıt şeması gevşek, eski fabrika alanı atar). Kiraya sıra pini konmaz; defter boşsa null.
 */
export async function leasePackageRevocation(db: Db, keys: KeyStore): Promise<string | null> {
  return (await newestPackageRevocation(db, keys))?.belge ?? null;
}

/** Çapaya karşı doğrulanan en yüksek sıralı dağıtım iptali (kiradaki belge budur); portal görünümü de bundan okur. */
export async function newestPackageRevocation(db: Db, keys: KeyStore): Promise<{ sira: number; belge: string; verified: VerifiedPackageRevocation } | null> {
  const rows = await db.paketIptalBelgesi.findMany({ orderBy: { sira: "desc" }, take: 16, select: { sira: true, belge: true } });
  for (const row of rows) {
    const v = verifyPackageRevocation(row.belge, keys.anchor);
    if (v.ok) return { sira: row.sira, belge: row.belge, verified: v.value };
  }
  return null;
}

/**
 * Portal (salt okuma): dağıtım iptali defteri (en yüksek sıra önce; belge metni listede yok) + kirada giden sıra +
 * anahtar biriminde açık sertifikası duran ISTEMCI/PAKET'ten iptal edilenler. Yazma yolu yok — belge törenden gelir.
 */
export async function packageRevocationStatus(db: Db, keys: KeyStore) {
  const rows = await db.paketIptalBelgesi.findMany({
    orderBy: { sira: "desc" },
    take: 50,
    select: { id: true, iptalId: true, sira: true, imzalayanKid: true, verilis: true, kidler: true, yukleyen: true, createdAt: true },
  });
  const newest = await newestPackageRevocation(db, keys);
  return {
    belgeler: rows,
    kiradakiSira: newest?.sira ?? null,
    iptalEdilenYukluler: keys.openCertificates.filter((c) => isPackageCertificateRevoked(c.document, newest?.verified)).map((c) => c.kid),
  };
}
