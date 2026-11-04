// Toplar ayrı geldi (Gülkesim fason) tel tipleri; servis dosyası satır tavanında olduğu için ayrı.
/** Belgenin tek top satırı (okuma özeti `docRolls`). */
export interface DocRoll {
  lineNo: number;
  meters: number;
  weightKg: number | null;
  senderRollNo: string | null;
}

/** Toplar ayrı geldi: her satır ayrı top (tek iş emri); `kursunMeters` = toplam. */
export interface CreateWorkOrderRoll {
  meters: number;
  weightKg?: number | null;
  senderRollNo?: string | null;
}
