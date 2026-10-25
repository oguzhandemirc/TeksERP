import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContractView } from "./contract";

/** Testler gerçek sevk irsaliyesi sözleşmesini paylaşılan fikstürden okur (elle kopya yok). */
export function loadFixture(): { contract: ContractView; settings: Record<string, unknown> } {
  const p = resolve(__dirname, "../../../../../../Teks-Erp/scripts/lib/belge-tasarimci-gidis-donus.json");
  return JSON.parse(readFileSync(p, "utf8")) as { contract: ContractView; settings: Record<string, unknown> };
}
