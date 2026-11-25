// Fire önceliği TEK cümle (ürün kartı denetimi T5): iplik kartı, çözgü kartı ve maliyet yapısı ⓘ'leri aynı metni basar.
// Sıra sunucudaki çözücülerin aynası: `resolveYarnWastePct` (iplik firesi) + `cost-assembler` zinciri (elle → yapı → kart → parametre).
export const WASTE_PRECEDENCE_TEXT =
  "Çözgü ve atkı ipliğine uygulanan fire, ilk dolu olandan alınır: iplik kartındaki iplik firesi → ürünün maliyet yapısı → çözgü kartı (yalnız çözgüde) → maliyet parametreleri. Hesaplayıcıda elle girilen fire hepsini ezer. Kumaş firesi bunlardan ayrı, en sonda uygulanır.";
