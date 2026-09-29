// EŞİTLEME ALICISI — `POST /v1/esitle` (sözleşme §6). Bulut HESAP YAPMAZ: fabrikanın hesapladığı
// satırı saklar. Paket tek tx'te, tesis başına sırayla uygulanır:
//   ① kiracı + tesis kilidi (try → 409 PAKET_ISLENIYOR) — İLK ifade
//   ② paket makbuzu: aynı paketId + aynı gövde → SAKLI yanıt (ağ tekrarı idempotent); başka gövde 409
//   ③ kayıtlar: katalog · alan sınıfı · katalog sürümü · filigran zinciri → yaz/sil (sürüm anı = ufuk;
//      eski paket yeni veriyi EZEMEZ) · TAM işaretle-süpür
//   ④ anlıklar ⑤ uzlaştırma ⑥ durum damgası ⑦ makbuz (yanıtla AYNI tx'te)
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { CLOCK_SKEW_MS, isPlainObject } from "../lisans-protokol";
import type { Tx } from "../lib/db";
import { CloudError, badRequest } from "../lib/errors";
import { LockBusyError, withTesis } from "../lib/tenant";
import { toPlainJson } from "../lib/idempotency";
import { PROJECTION_CATALOG } from "../catalog/projections";
import {
  ENVELOPE_VERSION,
  MAX_DECOMPRESSED_BYTES,
  MAX_RECORDS_PER_PACKAGE,
  PackageSchema,
  SYNC_CONTRACT_VERSION,
  type SyncPackage,
  type SyncResponse,
} from "../wire/esitleme";
import type { CloudContext } from "./context";
import type { FactoryCaller } from "./installation-auth";
import { applyRecordEntry, applySnapshot, reconcile, type PackageAccumulator } from "./sync-apply";

/** Sözleşme sürümü kararı (§6.6): N kabul · N−1 kabul + uyarı · daha eskisi 400 · daha yenisi 400. */
export function contractVerdict(version: number, current = SYNC_CONTRACT_VERSION): "OK" | "ESKI_UYARI" | "ESKI" | "YENI" {
  if (version === current) return "OK";
  if (version === current - 1 && version >= 1) return "ESKI_UYARI";
  return version < current ? "ESKI" : "YENI";
}

/** Gövde: gzip ise açılır (açılmış ≤ 32 MB); özet imza doğrulamasında HAM baytlardan alındı. */
export function decodeBody(raw: Buffer, contentEncoding: string | undefined): Buffer {
  const enc = (contentEncoding ?? "identity").trim().toLowerCase();
  if (enc === "identity" || enc === "") return raw;
  if (enc !== "gzip") throw badRequest(`Desteklenmeyen içerik kodlaması: ${enc}`);
  try {
    return gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch (err) {
    if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new CloudError(413, "PAKET_BUYUK", "Açılmış paket 32 MB sınırını aşıyor");
    }
    throw badRequest("Paket gzip olarak açılamadı");
  }
}

export function parsePackage(json: Buffer, caller: FactoryCaller, nowMs: number): SyncPackage {
  let value: unknown;
  try {
    value = JSON.parse(json.toString("utf8"));
  } catch {
    throw badRequest("Paket JSON değil");
  }
  if (!isPlainObject(value)) throw badRequest("Paket bir JSON nesnesi olmalı");
  if (value.v !== ENVELOPE_VERSION) throw new CloudError(400, "PROTOKOL_SURUMU", `Desteklenmeyen paket zarfı sürümü: ${String(value.v)}`);
  const parsed = PackageSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
    throw badRequest(`Paket sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
  }
  const pkg = parsed.data;
  if (pkg.kurulumId !== caller.installation.installationId) throw badRequest("Paketteki kurulum kimliği imzalı istekle uyuşmuyor");
  const verdict = contractVerdict(pkg.sozlesme);
  if (verdict === "ESKI") throw new CloudError(400, "SOZLESME_ESKI", "Fabrika programı eski — eşitleme için güncelleme gerekli");
  if (verdict === "YENI") throw new CloudError(400, "SOZLESME_BILINMIYOR", "Bu eşitleme sözleşmesi sürümünü bulut henüz tanımıyor");
  if (Date.parse(pkg.ufuk) > nowMs + CLOCK_SKEW_MS) throw badRequest("Paketin ufku gelecekte (fabrika saati ileri)");
  const records = pkg.kayitlar.reduce((n, e) => n + e.yaz.length + e.sil.length, 0);
  if (records > MAX_RECORDS_PER_PACKAGE) throw new CloudError(413, "PAKET_BUYUK", `Paket en çok ${MAX_RECORDS_PER_PACKAGE} kayıt taşır (${records})`);
  return pkg;
}

/** Paketin RLS kapsamı: yalnız katalogda TANINAN ve pakette ADI GEÇEN projeksiyonlar (`*` yok). */
function packageScope(pkg: SyncPackage): string[] {
  const names = new Set<string>();
  for (const e of pkg.kayitlar) names.add(e.projeksiyon);
  for (const s of pkg.anliklar) names.add(s.projeksiyon);
  for (const u of pkg.uzlastirma) names.add(u.projeksiyon);
  return [...names].filter((n) => PROJECTION_CATALOG.has(n));
}

function monthsBefore(nowMs: number, months: number): Date {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Saklama ufku (§9.5): budanan OLGU projeksiyonları için `şimdi − saklamaAy`; TAM gönderim bununla sınırlanır. */
export function retentionHorizons(retentionMonths: number | null, nowMs: number): Record<string, string> {
  if (retentionMonths === null) return {};
  const iso = monthsBefore(nowMs, retentionMonths).toISOString();
  const out: Record<string, string> = {};
  for (const def of PROJECTION_CATALOG.values()) if (def.root.kind === "OLGU" && def.root.retentionFields?.length) out[def.name] = iso;
  return out;
}

interface SyncStamp {
  readonly caller: FactoryCaller;
  readonly pkg: SyncPackage;
  readonly nowMs: number;
  readonly warning: SyncResponse["sozlesmeUyarisi"];
}

async function stampSyncState(tx: Tx, { caller, pkg, nowMs, warning }: SyncStamp): Promise<void> {
  const now = new Date(nowMs);
  const horizon = new Date(pkg.ufuk);
  const prior = await tx.syncState.findUnique({ where: { tesisId: caller.tesisId } });
  const moved = !prior || horizon.getTime() > prior.horizon.getTime();
  const data = {
    lastPackageAt: now,
    lastInstallationId: caller.installation.installationId,
    contractVersion: pkg.sozlesme,
    appVersion: pkg.uretimBilgisi.uygulamaSurum,
    horizon: moved ? horizon : prior.horizon,
    horizonChangedAt: moved ? now : prior.horizonChangedAt,
    contractWarning: warning,
  };
  await tx.syncState.upsert({ where: { tesisId: caller.tesisId }, create: { tesisId: caller.tesisId, ...data }, update: data });
}

export async function applyPackage(ctx: CloudContext, caller: FactoryCaller, g: { raw: Buffer; contentEncoding: string | undefined; nowMs: number }): Promise<SyncResponse> {
  const json = decodeBody(g.raw, g.contentEncoding);
  const pkg = parsePackage(json, caller, g.nowMs);
  const digest = createHash("sha256").update(json).digest("hex");
  const warning = contractVerdict(pkg.sozlesme) === "ESKI_UYARI" ? "FABRIKA_SURUMU_ESKI" : null;
  try {
    return await withTesis(
      ctx.sync,
      { tesisId: caller.tesisId, projections: packageScope(pkg), lock: { name: "PACKAGE", key: caller.tesisId, mode: "try" }, timeoutMs: 120_000 },
      async (tx) => {
        const prior = await tx.packageReceipt.findUnique({ where: { tesisId_packageId: { tesisId: caller.tesisId, packageId: pkg.paketId } } });
        if (prior) {
          if (prior.bodyDigest !== digest) throw new CloudError(409, "PAKET_KIMLIGI_CAKISTI", "Bu paket kimliği başka bir gövdeyle kullanılmış");
          return prior.response as unknown as SyncResponse;
        }
        const facility = await tx.facility.findUnique({ where: { tesisId: caller.tesisId } });
        if (!facility) throw new CloudError(401, "KURULUM_BILINMIYOR", "Kurulumun tesisi bulutta kayıtlı değil");
        const acc: PackageAccumulator = { kabul: [], ret: [], istenen: [] };
        const horizon = new Date(pkg.ufuk);
        for (const entry of pkg.kayitlar) await applyRecordEntry(tx, { tesisId: caller.tesisId, horizon, entry, nowMs: g.nowMs }, acc);
        for (const snap of pkg.anliklar) await applySnapshot(tx, { tesisId: caller.tesisId, horizon, snap }, acc);
        for (const rec of pkg.uzlastirma) await reconcile(tx, { tesisId: caller.tesisId, rec }, acc);
        const response: SyncResponse = {
          v: 1,
          paketId: pkg.paketId,
          kabul: acc.kabul,
          ret: acc.ret,
          istenen: acc.istenen,
          ufukTarihi: retentionHorizons(facility.retentionMonths, g.nowMs),
          sozlesmeUyarisi: warning,
        };
        await stampSyncState(tx, { caller, pkg, nowMs: g.nowMs, warning });
        await tx.packageReceipt.create({
          data: { tesisId: caller.tesisId, packageId: pkg.paketId, installationId: caller.installation.installationId, bodyDigest: digest, response: toPlainJson(response) },
        });
        return response;
      },
    );
  } catch (err) {
    if (err instanceof LockBusyError) throw new CloudError(409, "PAKET_ISLENIYOR", "Bu tesisin başka bir paketi işleniyor; biraz sonra tekrar deneyin");
    throw err;
  }
}
