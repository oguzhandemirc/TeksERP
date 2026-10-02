// Sunucu (backend) güncellemesi — `GET /api/guncelleme/durum` görünümü (backend `src/services/update-status.service.ts`
// `UpdateStatus`, sözleşme `docs/design/GUNCELLEYICI.md` §3.2 sürüm 4). Panel yalnız GÖSTERİR; karar güncelleyicinindir.

export type UpdatePolicyMode = "OTOMATIK" | "ONAYLI" | "DONDUR";
export type UpdateDecisionKind = "GUNCEL" | "DONDURULDU" | "UYGUN_DEGIL" | "ONAY_BEKLIYOR" | "PENCERE_BEKLIYOR" | "KUR";
export type UpdaterState = "CALISIYOR" | "DURDU" | "YOK" | "OLCULEMEDI";
export type UpdateResultKind = "BASARILI" | "GERI_DONDU" | "BASARISIZ";
export type ApprovalTiming = "HEMEN" | "PENCERE";
export type UpdateApprovalChoice = ApprovalTiming | "GERI_AL";

export interface UpdateWindowRule {
  baslangic: string;
  bitis: string;
  gunler: number[];
  saatDilimi: string;
}

export interface UpdateInterval {
  baslangic: string;
  bitis: string;
}

export interface UpdateResult {
  kayitId: string;
  hedefSurum: string;
  kaynakSurum: string | null;
  sonuc: UpdateResultKind;
  kod: string | null;
  baslangic: string;
  bitis: string;
  veriGeriYuklendi: boolean;
}

export interface UpdateHistoryItem extends UpdateResult {
  urun: "backend" | "pg";
  ayrintiKodu: string | null;
  pgSurum: string | null;
  onayId: string | null;
}

export interface UpdateApprovalView {
  onayId: string;
  surum: string;
  zamanlama: ApprovalTiming;
  onaylayan: { id: string; ad: string };
  zaman: string;
  kullanildi: boolean;
}

export interface UpdateActions {
  hemen: boolean;
  pencere: boolean;
  geriAl: boolean;
  hedefSurum: string | null;
  neden: string | null;
}

export interface UpdateStatus {
  kuruluSurum: string;
  kanal: string | null;
  politika: { kip: UpdatePolicyMode; pencere: UpdateWindowRule | null; hedefSurum: string | null; kaynak: "KIRA" | "VARSAYILAN" } | null;
  donuk: boolean;
  sonrakiPencere: UpdateInterval | null;
  indirmeBelirteci: boolean;
  guncelleyici: { durum: UpdaterState; surum: string | null };
  bekleyen: {
    surum: string;
    karar: UpdateDecisionKind;
    neden: string | null;
    zorunlu: boolean;
    ozet: string | null;
    aralik: UpdateInterval | null;
    pgGuncellemesi: boolean;
  } | null;
  son: UpdateResult | null;
  yerel: {
    durum: string;
    surum: string | null;
    kuruluSurum: string | null;
    urun: string | null;
    adim: string | null;
    hataKodu: string | null;
    mesaj: string | null;
    ilerleme: { indirilen: number; toplam: number } | null;
    planlanan: string | null;
    zaman: string | null;
    sonAyrinti: { urun: "backend" | "pg"; hataKodu: string | null; mesaj: string | null } | null;
    /** Sorun DEĞİL, bilgi (ör. SEMA_OLCULEMEDI); eski backend göndermez. */
    bilgi?: { kod: string; mesaj: string } | null;
  } | null;
  gecmis: UpdateHistoryItem[];
  karar: { karar: UpdateDecisionKind; neden: string | null } | null;
  canlilik: { sonCanlilik: string | null; esikSn: number | null; gecikmeSn: number | null; yanitVermiyor: boolean } | null;
  onay: UpdateApprovalView | null;
  eylemler: UpdateActions;
}

export interface RecordUpdateApprovalInput {
  clientToken: string;
  surum: string;
  zamanlama: UpdateApprovalChoice;
}

export interface UpdateApprovalResult {
  kayitId: string;
  niyet: { yazildi: boolean; kod: string | null };
  durum: UpdateStatus;
}
