// Gelen belge okuma özetinin müşteri (sahip) tipleri — `inboundDoc.service.ts` 300 satır sınırında olduğundan ayrı dosya;
// servis aynı adlarla yeniden dışa verir (çağıranlar değişmez).

export interface OwnerSuggestion {
  customerId: string;
  name: string;
  matchedText: string;
  /** OWNER_TEXT: okunan sahip alanı (alan dolar) · FULL_TEXT: sayfa metninde geçiyor (yalnız sorulur). Eski sunucu göndermez → alan dolar. */
  source?: 'OWNER_TEXT' | 'FULL_TEXT';
}

/** Çözülemeyen müşteri okuması: okunan ad + benzer aktif cariler (≥0,80, en çok 3, puan azalan). */
export interface OwnerUnmatched {
  text: string;
  candidates: { customerId: string; name: string; score: number }[];
}
