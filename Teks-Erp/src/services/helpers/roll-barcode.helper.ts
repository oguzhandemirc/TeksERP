import { v4 as uuidv4 } from "uuid";

/**
 * Ayraçsız top barkodu: TEKSYYYYMMDDXXXXXXXX (8 hex).
 * Tire YOK — el tarayıcı klavye-taklidi Türkçe düzende `-`'yi `*`'a çeviriyordu
 * (QR kamera doğru okuyordu, 1D wedge bozuyordu); ayraçsız salt harf-rakam her
 * klavye düzeninde sorunsuz okunur.
 *
 * `inventory.service` (KK1 giriş) ve `tambur.service` (çocuk top) tek kaynaktan
 * üretir — format/regex tek yerde tutulsun (F125).
 */
export const ROLL_BARCODE_RE = /^TEKS\d{8}[0-9A-F]{8}$/;

export function generateRollBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const randomPart = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  return `TEKS${datePart}${randomPart}`;
}
