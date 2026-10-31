// Tül Excel dönüştürücüsü (tasarım §9.5, dilim SY-H1) — TEK SEFERLİK kurulum betiği.
// Fabrika Excel'i → normalize CSV'ler + hata-raporu.csv. Yalnız dosya okur; DB'ye/sunucuya dokunmaz.
//
//   node --experimental-strip-types Electron/scripts/ice-aktar/tul-excel.ts \
//     --desen DÖNER-DESENLER.xlsx --maliyet TÜL-MALİYET.xlsx [--cikti <dizin>] [--duzeltilmis-kabul]
//
// --cikti yoksa DRY-RUN: yalnız özet basar, dosya yazmaz. Varsayılan: bulgulu satır CSV'ye
// yazılmaz, rapora yazılır; --duzeltilmis-kabul önerilen değerle yazar (fabrika teyidinden sonra).
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { convert, loadWorkbook, summarize } from "./tul-excel/convert.ts";
import { buildOutputs, toCsv } from "./tul-excel/output.ts";

interface CliArgs {
  designPath?: string;
  costPath?: string;
  outDir?: string;
  acceptCorrections: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { acceptCorrections: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} bir değer bekliyor`);
      return v;
    };
    if (a === "--desen") args.designPath = next();
    else if (a === "--maliyet") args.costPath = next();
    else if (a === "--cikti") args.outDir = next();
    else if (a === "--duzeltilmis-kabul") args.acceptCorrections = true;
    else throw new Error(`Bilinmeyen argüman: ${a}`);
  }
  if (!args.designPath && !args.costPath) throw new Error("En az biri gerekli: --desen <xlsx> | --maliyet <xlsx>");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const designBook = args.designPath
    ? { name: basename(args.designPath), workbook: await loadWorkbook(args.designPath) }
    : undefined;
  const costBook = args.costPath ? { name: basename(args.costPath), workbook: await loadWorkbook(args.costPath) } : undefined;
  const result = convert({ designBook, costBook });
  const out = buildOutputs(result, designBook?.name ?? "", args.acceptCorrections);

  console.log(`Desen sayfası okundu: ${result.designs.length} · maliyet sayfası okundu: ${result.costSheets.length}`);
  for (const s of result.skipped) console.log(`  ATLANDI (düzen tanınmadı): ${s.file} / ${s.sheet}`);
  console.log("Hata sınıfı · toplam · kullanımdaki satırda");
  for (const s of summarize(result)) console.log(`  ${s.errorClass.padEnd(22)} ${String(s.total).padStart(5)} ${String(s.inUse).padStart(5)}`);
  console.log(`Yüklenmeyen (teyit bekleyen): ${out.excluded.length}${args.acceptCorrections ? " (düzeltilmiş kabul AÇIK)" : ""}`);

  if (!args.outDir) {
    console.log("DRY-RUN: dosya yazılmadı (yazmak için --cikti <dizin>).");
    return;
  }
  await mkdir(args.outDir, { recursive: true });
  for (const [name, table] of Object.entries(out.files)) {
    await writeFile(join(args.outDir, name), toCsv(table), "utf8");
    console.log(`  yazıldı: ${join(args.outDir, name)} (${table.rows.length} satır)`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
