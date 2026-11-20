// =============================================================================
// UZAK TEST DB KABULÜ — iki host kapısının (db-guard · run-all-tests) TEK yüklemi
// =============================================================================
// NEDEN: geliştirme PG'si ThinkPad'e taşındı (`scripts/test-db.mjs`
// TEKSERP_TEST_DB_HOST/_PORT, PR #796); host kapıları ise yalnız yereli
// tanıyordu ve ajanlar Mac yerel PG'ye düşüyordu. Kabul DAR ve üç ayaklı:
// operatörün AÇIKÇA verdiği host + (verildiyse) port + `_test` adı. Biri
// tutmazsa bugünkü RED sürer (fail-closed); hacim/ad kapıları ayrıca arkada.
// =============================================================================

export interface UzakHedef {
  host: string;
  /** URL'deki port; boşsa PG varsayılanı 5432 sayılır. */
  port: string;
  db: string;
}

/** Uzak hedef açıkça beyan edilmiş test DB'si mi? Saf; bekçi env'i ayrıca verir. */
export function uzakTestDbKabulu(hedef: UzakHedef, env: NodeJS.ProcessEnv = process.env): boolean {
  const beyanHost = (env.TEKSERP_TEST_DB_HOST ?? "").trim().toLowerCase();
  if (!beyanHost) return false;
  if (hedef.host.trim().toLowerCase() !== beyanHost) return false;
  const beyanPort = (env.TEKSERP_TEST_DB_PORT ?? "").trim();
  if (beyanPort && (hedef.port || "5432") !== beyanPort) return false;
  return hedef.db.endsWith("_test");
}
