// B6/G3: etkinleşmemiş kurulumda `zorla` kipli başka kurulum izinin (KAYIP/BELIRSIZ) merdiven başlangıcı. Lisans kimliği
// yokken durum kaydı yazılmaz; sayacın kalıcı çapası LICENSE_DIR'deki bu dosyadır — DB'yi silmek/geri yüklemek onu
// sıfırlamaz. Her satır kurulum anahtarıyla imzalı; imzası tutmayan satır yok sayılır.
import fs from "node:fs";
import path from "node:path";
import { sign, verify } from "node:crypto";
import { z } from "zod";
import { activationLockEnabled } from "./activation-lock";
import { foreignTraceDetailOf } from "./activation-trace";
import { DAY_MS, IsoTimeSchema, UuidSchema, b64uDecode, b64uEncode, publicKeyFromX, type RootKey } from "./protocol";
import { LICENSE_FILES, getLicenseStore, writeFileAtomicSync, type InstallationKey } from "./store";

const MESSAGE_HEADER = "TEKSERP-YABANCI-IZ-BASLANGIC/v1";
const MAX_ROWS = 16;
const MAX_BYTES = 16 * 1024;

const RowSchema = z.object({ iz: UuidSchema, baslangic: IsoTimeSchema, imza: z.string().regex(/^[A-Za-z0-9_-]{86}$/) });
const FileSchema = z.object({ v: z.literal(1), kayitlar: z.array(RowSchema).max(MAX_ROWS) });
type Row = z.infer<typeof RowSchema>;

function message(kid: string, iz: string, baslangic: string): Buffer {
  return Buffer.from(`${MESSAGE_HEADER}\nkid:${kid}\niz:${iz}\nbaslangic:${baslangic}`, "utf8");
}

function rowValid(row: Row, key: InstallationKey): boolean {
  const pub = publicKeyFromX(key.x);
  const sig = b64uDecode(row.imza);
  if (!pub || !sig) return false;
  try {
    return verify(null, message(key.kid, row.iz, row.baslangic), pub, sig);
  } catch {
    return false;
  }
}

/** Bellek kopyası: depo dizini + anahtar değişince yeniden okunur; dosya yazılamazsa süreç içi başlangıç korunur. */
let cache: { dir: string; kid: string | null; rows: Map<string, number> } | null = null;

function readRows(dir: string, key: InstallationKey | null): Map<string, number> {
  const rows = new Map<string, number>();
  if (!key) return rows;
  try {
    const file = path.join(dir, LICENSE_FILES.FOREIGN_TRACE_EPOCH);
    if (!fs.existsSync(file) || fs.statSync(file).size > MAX_BYTES) return rows;
    const parsed = FileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    if (!parsed.success) return rows;
    for (const r of parsed.data.kayitlar) if (rowValid(r, key)) rows.set(r.iz, Date.parse(r.baslangic));
  } catch {
    // Okunamayan dosya: imzalı başlangıç yok — ilk görülme yeniden yazılır (silmekle eşdeğer; DB yolu yok).
  }
  return rows;
}

function writeRows(dir: string, key: InstallationKey, rows: Map<string, number>): void {
  const signed = [...rows.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_ROWS)
    .map(([iz, ms]) => {
      const baslangic = new Date(ms).toISOString();
      return { iz, baslangic, imza: b64uEncode(sign(null, message(key.kid, iz, baslangic), key.privateKey)) };
    });
  try {
    writeFileAtomicSync(path.join(dir, LICENSE_FILES.FOREIGN_TRACE_EPOCH), JSON.stringify({ v: 1, kayitlar: signed }));
  } catch {
    // Yazılamayan depo zaten KURULUM_HATASI kilidine düşer; burada bellek başlangıcı sürer.
  }
}

/** İzin (`izKurulumId`) merdiven başlangıcı: imzalı kayıt varsa o, yoksa `nowMs` yazılır. */
export function foreignTraceStartMs(izKurulumId: string, nowMs: number): number {
  const store = getLicenseStore();
  const dir = store?.dir ?? "";
  const key = store && !store.problem ? store.key : null;
  if (!cache || cache.dir !== dir || cache.kid !== (key?.kid ?? null)) cache = { dir, kid: key?.kid ?? null, rows: readRows(dir, key) };
  const known = cache.rows.get(izKurulumId);
  // İleri alınmış saatle yazılan başlangıç sayacı dondurmasın: gelecekteki başlangıç şimdiye çekilir.
  if (known !== undefined && Number.isFinite(known) && known <= nowMs + DAY_MS) return known;
  cache.rows.set(izKurulumId, nowMs);
  if (key) writeRows(dir, key, cache.rows);
  return nowMs;
}

/** Yabancı iz merdiveninin motor girdisi: dönem anahtarı + imzalı başlangıçtan geçen süre. */
export interface ForeignLadder {
  readonly kip: "zorla";
  readonly epoch: string;
  readonly storedMs: number;
  readonly baslangicMs: number;
}

/**
 * Yalnız etkinleştirme kilidi açık (korumalı derleme), kurulum etkin değil ve iz KAYIP/BELIRSIZ + `zorla` iken; gözlem
 * kipli iz (HAK'ında kip alt sınırı olmayan eski kurulum) null döner — bugünkü sınırsız davranış. Süre `max(duvar, defter yüksek
 * suyu)`ndan sayılır: saati geri almak süreyi uzatmaz.
 */
export function foreignLadderOf(g: { readonly activated: boolean; readonly roots: readonly RootKey[]; readonly nowMs: number; readonly highWaterMs: number | null }): ForeignLadder | null {
  if (g.activated || !activationLockEnabled()) return null;
  const d = foreignTraceDetailOf({ roots: g.roots });
  if (!d || d.kip !== "zorla" || d.sinif === "YABANCI") return null;
  const start = foreignTraceStartMs(d.izKurulumId, g.nowMs);
  const trusted = Math.max(g.nowMs, g.highWaterMs ?? 0);
  return { kip: "zorla", epoch: `yabanci:${d.izKurulumId}`, storedMs: Math.max(0, trusted - start), baslangicMs: start };
}

/** Test-only: bellek kopyasını düşürür (dosya diskte kalır — kalıcılık ölçümü bunu ister). */
export function __resetForeignTraceEpochForTests(): void {
  cache = null;
}
