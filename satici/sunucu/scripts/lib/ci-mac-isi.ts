// Linux koşucusunun macOS'a bıraktığı bekçi için ci.yml beyanı. `test_` öneki yok → koşucu bunu bekçi saymaz.
// Bekçiyi Linux'tan çıkarmak yalnız ci.yml onu koşturan bir macOS işi taşıyorsa meşrudur; yoksa hiçbir yerde koşmazdı.

/** ci.yml'de `runs-on: macos-*` olan ve `npx tsx scripts/<bekci>`i doğrudan koşturan işin adı; yoksa null. */
export function macIsiBul(ciYml: string, bekci: string): string | null {
  const komut = new RegExp(`^\\s*(?:-\\s*)?run:\\s*npx tsx scripts/${bekci.replace(/\./g, "\\.")}\\s*$`, "m");
  for (const blok of ciYml.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).slice(1)) {
    if (/^\s*runs-on:\s*macos-/m.test(blok) && komut.test(blok)) return blok.slice(0, blok.indexOf(":"));
  }
  return null;
}
