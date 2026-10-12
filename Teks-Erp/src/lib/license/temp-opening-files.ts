// Yazarak etkinleştirmenin LICENSE_DIR dosyaları: bekleyen istek eki, kabul edilen açılış kodu, tüketilen kod özetleri.
// Hiçbiri tek başına yetki vermez: açılış kaydı her okumada kökle yeniden doğrulanır (`temp-opening.ts`); tüketilen
// listesi yalnız tekrar kullanımı reddeder. Düz kod hiçbir dosyaya yazılmaz (özet + son 4).
import path from "node:path";
import { z } from "zod";
import { IsoTimeSchema } from "./protocol";
import { readJsonField } from "./store-files";
import { getLicenseStore, writeFileAtomicSync } from "./store";

/** Depo dosyaları (`LICENSE_FILES` dosya boyu sınırında; adlar burada, aynı dizinde). */
export const TEMP_FILES = {
  /** Ekrandaki istek kodunun rastgele eki (tüketilene/yenilenene dek sabit). */
  REQUEST: "gecici-istek.json",
  /** Kabul edilen geçici açılış kodu (kök imzalı; her okumada yeniden doğrulanır, tam etkinleştirme kapatır). */
  OPENING: "gecici-acilis.json",
  /** Tüketilen kodların özetleri (tek kullanım) + satıcıya bildirildi işareti — düz kod saklanmaz. */
  CONSUMED: "gecici-tuketilen.json",
} as const;

const B64U = /^[A-Za-z0-9_-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_CONSUMED = 64;

const RequestFileSchema = z.object({ v: z.literal(1), kid: z.string().min(1).max(200), ek: z.string().regex(B64U).max(16), olusturuldu: IsoTimeSchema });
export type TempRequestFile = z.infer<typeof RequestFileSchema>;

export const OpeningFileSchema = z.object({
  v: z.literal(1),
  istekKodu: z.string().min(1).max(64),
  kokKid: z.string().min(1).max(64),
  kodId: z.number().int().min(0),
  bitisGunu: z.number().int().min(0),
  imza: z.string().regex(B64U).max(200),
  ozet: z.string().regex(DIGEST),
  kodSonu: z.string().max(8),
  kabul: IsoTimeSchema,
  kapandi: IsoTimeSchema.nullable(),
  kapanisNedeni: z.string().max(40).nullable(),
});
export type TempOpeningFile = z.infer<typeof OpeningFileSchema>;

const ConsumedRowSchema = z.object({ ozet: z.string().regex(DIGEST), kabul: IsoTimeSchema, bildirildi: IsoTimeSchema.nullable() });
const ConsumedFileSchema = z.object({ v: z.literal(1), kayitlar: z.array(ConsumedRowSchema).max(MAX_CONSUMED) });
export type TempConsumedRow = z.infer<typeof ConsumedRowSchema>;

function storeDir(): string | null {
  const s = getLicenseStore();
  return s && !s.problem ? s.dir : null;
}

/** JSON dosyası: yok/biçimsiz → null; okunamayan dosya da null (çağıran "yok" gibi davranır, yetki doğmaz). */
function readParsed<T>(file: string, schema: z.ZodType<T>): T | null {
  const dir = storeDir();
  if (!dir) return null;
  const raw = readJsonField(path.join(dir, file), []);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function write(file: string, body: unknown): void {
  const dir = storeDir();
  if (!dir) throw new Error("lisans deposu kullanılamıyor");
  writeFileAtomicSync(path.join(dir, file), JSON.stringify(body));
}

export const readTempRequestFile = (): TempRequestFile | null => readParsed(TEMP_FILES.REQUEST, RequestFileSchema);
export const writeTempRequestFile = (f: TempRequestFile): void => write(TEMP_FILES.REQUEST, f);

export const readTempOpeningFile = (): TempOpeningFile | null => readParsed(TEMP_FILES.OPENING, OpeningFileSchema);
export const writeTempOpeningFile = (f: TempOpeningFile): void => write(TEMP_FILES.OPENING, f);

export function readTempConsumed(): TempConsumedRow[] {
  return readParsed(TEMP_FILES.CONSUMED, ConsumedFileSchema)?.kayitlar ?? [];
}

/** En yeni MAX_CONSUMED satır tutulur (eski satır zaten eski istek koduna bağlıdır; imzası yeniden tutmaz). */
export function writeTempConsumed(rows: readonly TempConsumedRow[]): void {
  write(TEMP_FILES.CONSUMED, { v: 1, kayitlar: rows.slice(-MAX_CONSUMED) });
}

/** Test-only: depodaki üç dosyanın yolu. */
export function tempOpeningPathsForTests(): { istek: string; acilis: string; tuketilen: string } | null {
  const dir = storeDir();
  if (!dir) return null;
  return {
    istek: path.join(dir, TEMP_FILES.REQUEST),
    acilis: path.join(dir, TEMP_FILES.OPENING),
    tuketilen: path.join(dir, TEMP_FILES.CONSUMED),
  };
}
