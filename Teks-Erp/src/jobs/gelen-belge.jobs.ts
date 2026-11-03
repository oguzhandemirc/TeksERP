// Gelen belge arka plan işleri tek giriş: okuma kuyruğu (D3b) + belge fotoğrafı saklama (K28).
// Saklama işi okuma servisinden bağımsız başlar (SİL kipleri servis istemez; KÜÇÜLT servis yoksa TAM bırakır).
import { startDocumentReader, stopDocumentReader } from "./gelen-belge-okuma.job";
import { startPhotoRetention, stopPhotoRetention } from "./gelen-belge-foto-saklama.job";

export function startIncomingDocJobs(): void {
  startDocumentReader();
  startPhotoRetention();
}

export function stopIncomingDocJobs(): void {
  stopDocumentReader();
  stopPhotoRetention();
}
