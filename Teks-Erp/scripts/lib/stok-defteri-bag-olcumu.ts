// =============================================================================
// "SEVKİYAT (ve kardeşleri) STOK DEFTERİNE BAĞLI MI?" — MEKANİK ÖLÇÜM
// =============================================================================
// Açılış fotoğrafının SIKI modu bu soruya "evet" alamadan `--apply`yi reddeder.
// Cevap bir bayrak ya da beyan DEĞİL, iki bağımsız araçla ölçülür:
//
//   K — KOD YOLU (bu ağaç): konum defteri kapısı `writeWarehouseMovement(s)`
//       from/to STATÜ yazmaz; helper dışında onu çağıran her yol (sevk · storno ·
//       iade · transfer) statüsüz satır üretir. AST ile sayılır, yorum/import
//       sayılmaz. Pozitif kontrol: helper dosyasında iki tanım da BULUNMALI —
//       bulunamazsa araç bozuk/eski demektir ve sonuç "0 çağıran" sayılmaz.
//
//   V — VERİ (hedef DB): eski kapıdan yazılmış (iki ucu statüsüz) en yeni satırın
//       tarihi ile stok defteri kapısından yazılmış (statülü) en yeni satırın
//       tarihi karşılaştırılır. Statüsüz satır statülüden YENİYSE, sahadaki
//       backend'in yeni kapıyı kullandığına dair kanıt yoktur (bu ağaç taşınmış
//       olsa bile sahada eski sürüm koşuyor olabilir). Aile bazında son satır
//       durumu BİLGİ olarak da döner.
//
// Sıkı mod geçer ⇔ K = 0 ∧ V "kanıt var / eski satır yok".
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as ts from "typescript";
import type { PrismaClient, RollStatus } from "@prisma/client";
import { Prisma, WarehouseEventType } from "@prisma/client";

/** Konum defteri kapısı — statüsüz satır yazan iki fonksiyon. */
export const ESKI_KAPI_FONKSIYONLARI: readonly string[] = ["writeWarehouseMovement", "writeWarehouseMovements"];
export const ESKI_KAPI_HELPER = "src/services/helpers/warehouse-ledger.helper.ts";
/** Eski kapının bugün yazdığı olay aileleri (V'nin aile bazlı bilgi satırı). */
export const ESKI_KAPI_AILELERI: readonly WarehouseEventType[] = [
  WarehouseEventType.SHIPMENT,
  WarehouseEventType.SHIPMENT_REVERSAL,
  WarehouseEventType.RETURN,
  WarehouseEventType.TRANSFER,
  WarehouseEventType.TRANSFER_REVERSAL,
];

export interface KodCagirani {
  dosya: string;
  satir: number;
  fonksiyon: string;
}

export interface KodOlcumu {
  /** Helper dosyasında iki tanım da bulundu — araç bir şeye BAKIYOR. */
  aracSaglam: boolean;
  aracNotu: string | null;
  taranan: number;
  cagiranlar: KodCagirani[];
  /** Ağacın kimliği — sahadaki backend'in ağacıyla karşılaştırmak için (best-effort). */
  agac: string;
}

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  const yigin = [dizin];
  while (yigin.length) {
    const d = yigin.pop() as string;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        yigin.push(p);
      } else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
  }
  return out.sort();
}

/** Çağrılan ifadenin son tanımlayıcısı: `foo(` → foo, `x.foo(` → foo. */
function callee(node: ts.CallExpression): string | null {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function agacKimligi(kok: string): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: kok, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const kirli = execSync("git status --porcelain -- src", { cwd: kok, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return `${sha}${kirli ? " (src'de commit edilmemiş değişiklik var)" : ""}`;
  } catch {
    return "(git okunamadı)";
  }
}

/**
 * K — bu ağaçta eski kapıyı çağıran yollar. `kok` backend kökü (package.json'un dizini).
 * Helper'ın kendisi muaf (tanımlar orada); testler ve `.d.ts` taranmaz.
 */
export function eskiKapiCagiranlari(kok: string): KodOlcumu {
  const helperYolu = path.join(kok, ESKI_KAPI_HELPER);
  const agac = agacKimligi(kok);
  if (!fs.existsSync(helperYolu)) {
    return { aracSaglam: false, aracNotu: `helper bulunamadı: ${ESKI_KAPI_HELPER}`, taranan: 0, cagiranlar: [], agac };
  }
  const helperSf = ts.createSourceFile(helperYolu, fs.readFileSync(helperYolu, "utf8"), ts.ScriptTarget.Latest, true);
  const tanimlar = new Set<string>();
  helperSf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) tanimlar.add(n.name.text);
  });
  const eksik = ESKI_KAPI_FONKSIYONLARI.filter((f) => !tanimlar.has(f));
  if (eksik.length > 0) {
    return {
      aracSaglam: false,
      aracNotu: `helper'da tanım yok: ${eksik.join(", ")} — araç eski ya da kapı yeniden adlandırıldı; "0 çağıran" sonucu GEÇERSİZ`,
      taranan: 0,
      cagiranlar: [],
      agac,
    };
  }
  const cagiranlar: KodCagirani[] = [];
  const dosyalar = tsDosyalari(path.join(kok, "src")).filter((d) => path.relative(kok, d) !== ESKI_KAPI_HELPER);
  for (const dosya of dosyalar) {
    const sf = ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const ad = callee(n);
        if (ad && ESKI_KAPI_FONKSIYONLARI.includes(ad)) {
          cagiranlar.push({ dosya: path.relative(kok, dosya), satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, fonksiyon: ad });
        }
      }
      n.forEachChild(gez);
    };
    sf.forEachChild(gez);
  }
  return { aracSaglam: true, aracNotu: null, taranan: dosyalar.length, cagiranlar, agac };
}

export interface AileSonSatiri {
  aile: WarehouseEventType;
  /** Ailede hiç satır yoksa null. */
  sonCreatedAt: Date | null;
  sonStatulu: boolean | null;
  statusuzToplam: number;
}

export interface VeriOlcumu {
  /** Pozitif kontrol: defterde hiç satır yoksa V bir şey ölçemez. */
  toplamSatir: number;
  enYeniStatusuz: Date | null;
  enYeniStatulu: Date | null;
  /** Statüsüz satır yok YA DA en yeni statülü satır en yeni statüsüzden yeni. */
  kanitVar: boolean;
  aileler: AileSonSatiri[];
}

type OkuyanClient = Pick<PrismaClient, "warehouseMovement">;

/** V — hedef DB'de eski kapı izi. Yalnız OKUR. */
export async function eskiKapiVeriIzi(prisma: OkuyanClient): Promise<VeriOlcumu> {
  const statusuzWhere = { fromStatus: null, toStatus: null } as const;
  const statuluWhere: Prisma.WarehouseMovementWhereInput = { OR: [{ fromStatus: { not: null } }, { toStatus: { not: null } }] };
  const sec = { createdAt: true, fromStatus: true, toStatus: true } as const;
  const toplamSatir = await prisma.warehouseMovement.count();
  const sonStatusuz = await prisma.warehouseMovement.findFirst({ where: statusuzWhere, orderBy: { createdAt: "desc" }, select: sec });
  const sonStatulu = await prisma.warehouseMovement.findFirst({ where: statuluWhere, orderBy: { createdAt: "desc" }, select: sec });
  const aileler: AileSonSatiri[] = [];
  for (const aile of ESKI_KAPI_AILELERI) {
    const son = await prisma.warehouseMovement.findFirst({ where: { eventType: aile }, orderBy: { createdAt: "desc" }, select: sec });
    const statusuzToplam = await prisma.warehouseMovement.count({ where: { eventType: aile, ...statusuzWhere } });
    aileler.push({
      aile,
      sonCreatedAt: son?.createdAt ?? null,
      sonStatulu: son ? statulu(son.fromStatus, son.toStatus) : null,
      statusuzToplam,
    });
  }
  const enYeniStatusuz = sonStatusuz?.createdAt ?? null;
  const enYeniStatulu = sonStatulu?.createdAt ?? null;
  const kanitVar = enYeniStatusuz === null || (enYeniStatulu !== null && enYeniStatulu.getTime() > enYeniStatusuz.getTime());
  return { toplamSatir, enYeniStatusuz, enYeniStatulu, kanitVar, aileler };
}

function statulu(from: RollStatus | null, to: RollStatus | null): boolean {
  return from !== null || to !== null;
}

export interface BagKarari {
  bagli: boolean;
  /** Türkçe, satır satır — kuru koşum bunları basar. */
  gerekceler: string[];
}

/** K ∧ V → sıkı modun kapısı. Sıralı gerekçe üretir; karar fail-closed. */
export function sevkBagiKarari(kod: KodOlcumu, veri: VeriOlcumu): BagKarari {
  const g: string[] = [];
  let bagli = true;
  if (!kod.aracSaglam) {
    bagli = false;
    g.push(`K ARAÇ BOZUK: ${kod.aracNotu} — ölçüm yapılamadı, fail-closed.`);
  } else if (kod.cagiranlar.length > 0) {
    bagli = false;
    g.push(`K KOD YOLU (ağaç ${kod.agac}): eski kapı ${kod.cagiranlar.length} yerden çağrılıyor (${kod.taranan} dosya tarandı):`);
    for (const c of kod.cagiranlar) g.push(`    ${c.dosya}:${c.satir} → ${c.fonksiyon}()`);
  } else {
    g.push(`K KOD YOLU (ağaç ${kod.agac}): eski kapı çağıranı 0 (${kod.taranan} dosya tarandı) ✓`);
  }
  if (veri.toplamSatir === 0) {
    g.push("V VERİ: defterde hiç satır yok — veri ayağı ölçülemez (bilgi).");
  } else if (veri.kanitVar) {
    g.push(
      `V VERİ: ${veri.enYeniStatusuz ? `en yeni statüsüz satır ${veri.enYeniStatusuz.toISOString()}, ondan sonra stok defteri kapısından yazılmış satır var (${veri.enYeniStatulu?.toISOString()})` : "statüsüz satır yok"} ✓`,
    );
  } else {
    bagli = false;
    g.push(
      `V VERİ: en yeni statüsüz (eski kapı) satır ${veri.enYeniStatusuz?.toISOString()}; ondan sonra stok defteri kapısından yazılmış satır YOK` +
        `${veri.enYeniStatulu ? ` (en yeni statülü ${veri.enYeniStatulu.toISOString()})` : " (statülü satır hiç yok)"} — sahadaki backend'in yeni kapıyı kullandığına kanıt yok.`,
    );
  }
  for (const a of veri.aileler) {
    const durum = a.sonCreatedAt === null ? "satır yok" : `son satır ${a.sonCreatedAt.toISOString().slice(0, 10)} ${a.sonStatulu ? "STATÜLÜ" : "statüsüz"}`;
    g.push(`    ${a.aile.padEnd(18)} ${durum} · statüsüz toplam ${a.statusuzToplam}`);
  }
  return { bagli, gerekceler: g };
}
