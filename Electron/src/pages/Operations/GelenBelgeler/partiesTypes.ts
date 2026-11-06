// `GET /gelen-belge/irsaliyeler/:id/partiler` yanıtı (tablet `types/inboundDocWoCreate.ts` NoteParty aynası). Çok blok
// alanları (işlem, müşteri İE no, bağlı İE) eski sunucuda yoktur → isteğe bağlı, kart yoksa gizler.
export interface NoteParty {
  blockNo: number;
  batchNo: string | null;
  orderNo: string | null;
  declaredTopCount: number | null;
  declaredMeters: number | null;
  lineCount: number;
  meters: number;
  weightKg: number | null;
  warnings: string[];
  processText?: string | null;
  senderWorkOrderNo?: string | null;
  workOrders?: { id: string; workOrderNumber: string; status: string }[];
}

export interface NotePartiesView {
  parties: NoteParty[];
  warnings: string[];
  multi: boolean;
  defaultMode: "SINGLE" | "PER_PARTY";
}
