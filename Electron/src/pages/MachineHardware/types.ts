/**
 * Saha donanım config — makine başına yazıcı + RS232 ara cihaz bilgileri +
 * gelen veriyi çözen regex desenleri. Dokümantasyon + cihaz/kodlama seçimi.
 * (Tablet pairing'i tutan Device'tan AYRI.)
 */
export interface MachineHardware {
  id: string;
  machineId: string;
  printerIp: string | null;
  printerMac: string | null;
  kqMac: string | null;
  mtMac: string | null;
  mtMac2: string | null;
  kqPattern: string | null;
  mtPattern: string | null;
  mtPattern2: string | null;
  notes: string | null;
  isActive: boolean;
  /** Yazıcı modeli + etiket format profili referansı (boş = tanımsız/model default). */
  printerModelId: string | null;
  formatProfileId: string | null;
  printerModel?: { id: string; code: string; name: string } | null;
  formatProfile?: { id: string; code: string; name: string } | null;
  machine?: { id: string; code: string; name: string; stationId: string };
  createdAt: string;
  updatedAt: string;
}
