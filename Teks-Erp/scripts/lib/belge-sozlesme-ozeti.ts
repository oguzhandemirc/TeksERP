// =============================================================================
// Belge veri sözleşmesi ÖZETİ — üretici + "yalnız büyür" karşılaştırıcısı
// Çalıştır: npx tsx scripts/lib/belge-sozlesme-ozeti.ts          (fark raporu)
//           npx tsx scripts/lib/belge-sozlesme-ozeti.ts --yaz    (dosyayı yenile)
// =============================================================================
// Özet `belge-sozlesme-ozeti.json`: docType → {contractVersion, alanlar: yol → {tur, sinif}}.
// Kayıtlı şablonlar bu yollara atıf yapar; yol silinirse/türü ya da sınıfı değişirse
// yayınlanmış şablon `strictVariables` ile düşer. `--yaz` ihlal varken YAZMAZ.
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  listContracts,
  contractPaths,
  type SummaryEntry,
} from "../../src/services/document-template/sozlesme/kayit";

export const OZET_DOSYASI = join(__dirname, "belge-sozlesme-ozeti.json");

export interface TurOzeti {
  contractVersion: number;
  alanlar: Record<string, SummaryEntry>;
}
export type Ozet = Record<string, TurOzeti>;

/** Kayıtlı sözleşmelerden özet — anahtarlar sıralı (deterministik dosya). */
export function ozetUret(): Ozet {
  const out: Ozet = {};
  for (const s of listContracts()) {
    const yollar = contractPaths(s);
    out[s.docType] = {
      contractVersion: s.contractVersion,
      alanlar: Object.fromEntries(Object.keys(yollar).sort().map((y) => [y, yollar[y]!])),
    };
  }
  return out;
}

export function ozetOku(dosya = OZET_DOSYASI): Ozet | null {
  return existsSync(dosya) ? (JSON.parse(readFileSync(dosya, "utf8")) as Ozet) : null;
}

/** "Yalnız büyür" ihlalleri: tür/alan çıkarma, tür ya da sınıf değişimi, sürümsüz büyüme. */
export function ozetIhlalleri(eski: Ozet, yeni: Ozet): string[] {
  const out: string[] = [];
  for (const [dt, e] of Object.entries(eski)) {
    const y = yeni[dt];
    if (!y) {
      out.push(`${dt}: sözleşme kaydı çıkarılmış`);
      continue;
    }
    for (const [yol, ea] of Object.entries(e.alanlar)) {
      const ya = y.alanlar[yol];
      if (!ya) out.push(`${dt}: alan çıkarılmış → ${yol}`);
      else if (ya.tur !== ea.tur) out.push(`${dt}: tür değişmiş → ${yol} (${ea.tur} → ${ya.tur})`);
      else if (ya.sinif !== ea.sinif) out.push(`${dt}: sınıf değişmiş → ${yol} (${ea.sinif} → ${ya.sinif})`);
    }
    if (y.contractVersion < e.contractVersion) {
      out.push(`${dt}: contractVersion geriye gitmiş (${e.contractVersion} → ${y.contractVersion})`);
    }
    const yeniYol = Object.keys(y.alanlar).filter((yol) => !(yol in e.alanlar));
    if (yeniYol.length && y.contractVersion <= e.contractVersion) {
      out.push(`${dt}: ${yeniYol.length} alan eklendi ama contractVersion artmadı (${e.contractVersion}) — örn. ${yeniYol[0]}`);
    }
  }
  return out;
}

/** Dosyada henüz olmayan (eklenmiş) tür/alanlar — ihlal değil, `--yaz` ile işlenir. */
export function ozetEksikleri(eski: Ozet, yeni: Ozet): string[] {
  const out: string[] = [];
  for (const [dt, y] of Object.entries(yeni)) {
    const e = eski[dt];
    if (!e) {
      out.push(`${dt}: yeni sözleşme`);
      continue;
    }
    for (const yol of Object.keys(y.alanlar)) if (!(yol in e.alanlar)) out.push(`${dt}: yeni alan → ${yol}`);
    if (y.contractVersion !== e.contractVersion) out.push(`${dt}: contractVersion ${e.contractVersion} → ${y.contractVersion}`);
  }
  return out;
}

if (require.main === module) {
  const yeni = ozetUret();
  const eski = ozetOku() ?? {};
  const ihlal = ozetIhlalleri(eski, yeni);
  const eksik = ozetEksikleri(eski, yeni);
  for (const i of ihlal) console.log(`  ❌ ${i}`);
  for (const e of eksik) console.log(`  ➕ ${e}`);
  if (ihlal.length) {
    console.log("Özet YAZILMADI: sözleşme yalnız büyür — ihlali geri al.");
    process.exit(1);
  }
  if (process.argv.includes("--yaz")) {
    writeFileSync(OZET_DOSYASI, `${JSON.stringify(yeni, null, 1)}\n`);
    console.log(`Özet yazıldı → ${OZET_DOSYASI}`);
  } else if (eksik.length) {
    console.log("Özet güncel değil — `--yaz` ile yenile.");
  } else {
    console.log("Özet güncel.");
  }
}
