// İPTAL BELGESİ deposu (G4): kök imzalı iptal belgesinin iki kopyası — `LICENSE_DIR/iptal.jws` ve fabrika DB'sindeki
// ayrılmış ayar `license.revocation`. Etkin belge, çekirdekte doğrulanan kopyaların EN YÜKSEK sıralısıdır (doğrulanamayan
// kopya yok sayılır); sıra yalnız artar. Bu modül DB'ye inmez: satırı servis okur/yazar (`license-revocation.service`).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { JwsTextSchema, isCertificateRevoked, type CertificateDoc, type RootKey } from "./protocol";
import type { LicenseCore, RevocationView } from "./license-core";
import { anchorArgument } from "./core-bridge";
import { getLicenseCore } from "./native";
import { LICENSE_FILES, getLicenseStore } from "./store";
import { readFileState, writeFileAtomicSync, type FileRead } from "./store-files";
import { bumpLicenseSnapshotVersion } from "./license-signals";

const MAX_REVOCATION_BYTES = 128 * 1024;

export const RevocationRowSchema = z.object({ v: z.literal(1), jws: JwsTextSchema });
export type RevocationRow = z.infer<typeof RevocationRowSchema>;

/** Çekirdekte doğrulanmış iptal belgesi: metin (çekirdeğe yalnız bu geçer) + görünüm. */
export interface HeldRevocation {
  readonly jws: string;
  readonly view: RevocationView;
}

export interface RevocationHolding {
  /** Etkin belge: iki kopyanın doğrulanmış en yüksek sıralısı; yoksa null. */
  readonly effective: HeldRevocation | null;
  readonly file: HeldRevocation | null;
  readonly db: HeldRevocation | null;
  /** Dosya VAR ama okunamadı (izin/G-Ç) — yok sayılmaz, kopya ölçülemedi. */
  readonly fileUnreadable: boolean;
  /** DB kopyası okundu (VAR ya da YOK); okunamadıysa BİLİNMİYOR — kayıp sayılmaz. */
  readonly dbKnown: boolean;
}

// ── Dosya: tembel okuma, stat önbelleği (yol + mtime + boyut) ───────────────────
let fileCache: { readonly file: string; readonly mtimeMs: number; readonly size: number; readonly read: FileRead } | null = null;

function revocationFile(): string | null {
  const store = getLicenseStore();
  return store ? path.join(store.dir, LICENSE_FILES.REVOCATION) : null;
}

function readRevocationFile(): FileRead {
  const file = revocationFile();
  if (!file) return { kind: "YOK" };
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (err) {
    return (err as { code?: string } | null)?.code === "ENOENT" ? { kind: "YOK" } : { kind: "OKUNAMADI" };
  }
  if (fileCache && fileCache.file === file && fileCache.mtimeMs === st.mtimeMs && fileCache.size === st.size) return fileCache.read;
  const read = readFileState(file, MAX_REVOCATION_BYTES);
  fileCache = { file, mtimeMs: st.mtimeMs, size: st.size, read };
  return read;
}

// ── DB kopyası (servis doldurur) ────────────────────────────────────────────────
type RowState = { readonly durum: "BILINMIYOR" } | { readonly durum: "YOK" } | { readonly durum: "VAR"; readonly jws: string };
let rowState: RowState = { durum: "BILINMIYOR" };

/** DB'den okunan değer (`null` = satır yok); biçimsiz değer YOK sayılır (bozuk kopya). */
export function setRevocationRow(value: unknown): void {
  const parsed = value === null ? null : RevocationRowSchema.safeParse(value);
  const next: RowState = parsed?.success ? { durum: "VAR", jws: parsed.data.jws } : { durum: "YOK" };
  if (JSON.stringify(next) === JSON.stringify(rowState)) return;
  rowState = next;
  bumpLicenseSnapshotVersion();
}

/** Okuma/yazma başarısız: DB kopyası bilinmiyor. */
export function markRevocationRowUnknown(): void {
  if (rowState.durum === "BILINMIYOR") return;
  rowState = { durum: "BILINMIYOR" };
  bumpLicenseSnapshotVersion();
}

// ── Doğrulama (çekirdekte; metin başına önbellek) ───────────────────────────────
let verified: { roots: readonly RootKey[]; core: LicenseCore; byJws: Map<string, RevocationView | null> } | null = null;

/** İptal metnini çekirdekte doğrular; doğrulanamayan (biçimsiz, imzasız, tanınmayan kök) null. */
export function verifyHeldRevocation(jws: unknown, roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): HeldRevocation | null {
  if (typeof jws !== "string") return null;
  if (!verified || verified.roots !== roots || verified.core !== core) verified = { roots, core, byJws: new Map() };
  let view = verified.byJws.get(jws);
  if (view === undefined) {
    const r = core.verifyRevocation(jws, anchorArgument(roots));
    view = r.ok ? r.value : null;
    if (verified.byJws.size > 16) verified.byJws.clear();
    verified.byJws.set(jws, view);
  }
  return view ? { jws, view } : null;
}

export function revocationSira(r: HeldRevocation | null): number {
  return r ? r.view.document.sira : 0;
}

/** Yüksek sıra kazanır; eşitlikte mevcut kalır (çırpınmaz). */
export function newerRevocation(current: HeldRevocation | null, incoming: HeldRevocation | null): HeldRevocation | null {
  return revocationSira(incoming) > revocationSira(current) ? incoming : current;
}

export function revocationHolding(roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): RevocationHolding {
  const read = readRevocationFile();
  const file = read.kind === "METIN" ? verifyHeldRevocation(read.text, roots, core) : null;
  const db = rowState.durum === "VAR" ? verifyHeldRevocation(rowState.jws, roots, core) : null;
  return { effective: newerRevocation(file, db), file, db, fileUnreadable: read.kind === "OKUNAMADI", dbKnown: rowState.durum !== "BILINMIYOR" };
}

/** Bu iptal belgesi verilen sertifikayı (kimliği ya da kid + kullanımıyla) iptal ediyor mu. */
export function revokesCertificate(r: HeldRevocation | null, cert: CertificateDoc): boolean {
  return r !== null && isCertificateRevoked(cert, r.view);
}

// ── Yazım: dosya senkron, DB kopyası sıralı kuyrukta ────────────────────────────
type RevocationWriter = (row: RevocationRow) => Promise<void>;
let writer: RevocationWriter | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function registerRevocationWriter(fn: RevocationWriter | null): void {
  writer = fn;
}

export function flushRevocationWrites(): Promise<void> {
  return writeQueue;
}

/** Yazıcının sonucu: başarıda satır budur; düşerse kopya BİLİNMİYOR (sonraki okuma tazeler). */
export function acknowledgeRevocationWrite(row: RevocationRow | null): void {
  if (row) setRevocationRow(row);
  else markRevocationRowUnknown();
}

function writeFileCopy(jws: string): boolean {
  const store = getLicenseStore();
  const file = revocationFile();
  if (!store || !file || (store.problem !== null && store.problem !== "OKUNAMADI")) return false;
  try {
    writeFileAtomicSync(file, `${jws}\n`);
  } catch {
    return false;
  }
  fileCache = null;
  return true;
}

function writeDbCopy(jws: string): boolean {
  const fn = writer;
  if (!fn) return false;
  const row: RevocationRow = { v: 1, jws };
  // Bellek hâli yazımla ilerler; yazım düşerse BİLİNMİYOR'a döner.
  setRevocationRow(row);
  writeQueue = writeQueue.then(() => fn(row)).catch(() => undefined);
  return true;
}

export interface AdoptResult {
  readonly adopted: boolean;
  readonly sira: number | null;
  readonly kayitSayisi: number | null;
}

/** Yalnız doğrulanmış ve etkin olandan YÜKSEK sıralı belge iki kopyaya yazılır; eşit/düşük/doğrulanamayan reddedilir. */
export function adoptRevocation(jws: string, roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): AdoptResult {
  const incoming = verifyHeldRevocation(jws, roots, core);
  const held = revocationHolding(roots, core).effective;
  if (!incoming || revocationSira(incoming) <= revocationSira(held)) return { adopted: false, sira: null, kayitSayisi: null };
  writeFileCopy(incoming.jws);
  writeDbCopy(incoming.jws);
  bumpLicenseSnapshotVersion();
  return { adopted: true, sira: incoming.view.document.sira, kayitSayisi: incoming.view.document.iptaller.length };
}

/** Onarım (sessiz, best-effort): eksik ya da düşük kopya etkin belgeden yeniden yazılır; okunamayan dosya ve bilinmeyen DB'ye dokunulmaz. */
export function repairRevocationCopies(roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): { file: boolean; db: boolean } {
  const h = revocationHolding(roots, core);
  const best = h.effective;
  if (!best) return { file: false, db: false };
  const order = revocationSira(best);
  const file = !h.fileUnreadable && revocationSira(h.file) < order ? writeFileCopy(best.jws) : false;
  const db = h.dbKnown && revocationSira(h.db) < order ? writeDbCopy(best.jws) : false;
  if (file) bumpLicenseSnapshotVersion();
  return { file, db };
}

/** Test-only. */
export function __resetRevocationStoreForTests(): void {
  fileCache = null;
  rowState = { durum: "BILINMIYOR" };
  verified = null;
  writeQueue = Promise.resolve();
}
