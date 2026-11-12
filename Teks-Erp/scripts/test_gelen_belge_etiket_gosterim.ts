// Saf bekçi: desen/renk görüntü etiketi katalogdan (eski saklı etiket ezilir) + desenRenkEslesme varsayılanı KAPALI.
// Negatif sonda: displayFieldLabel'da desen/renk dalı kalkınca ya da varsayılan KAPALI dışı olunca kırmızı.
import { displayFieldLabel } from "../src/lib/gelen-belge/alan-hedef";
import { readFileSync } from "fs";

let fail = 0;
let passed = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (ok) passed++; else fail++; };
check("desen → Gelen kumaş", displayFieldLabel("desen", "Hedef kumaş (desen)") === "Gelen kumaş");
check("renk → Gelen renk", displayFieldLabel("renk", "Hedef renk") === "Gelen renk");
check("diğer alan saklı etiket", displayFieldLabel("partiNo", "Parti") === "Parti");
check("desenRenkEslesme varsayılanı KAPALI (bugünkü davranış)", /DEFAULT_DESEN_RENK_ESLESME: DesenRenkEslesmeMode = "KAPALI"/.test(readFileSync("src/services/system-setting/incoming-docs.ts", "utf8")));
console.log(`\n=== Sonuç: ${passed} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
