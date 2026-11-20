// Son API hatası — destek talebinin bağlamına "varsa son hata" olarak girer.
// Yalnız bellekte tutulur (diske yazılmaz). İçerik: yöntem + YOL (sorgu atılır)
// + durum + Türkçe mesaj; istek gövdesi, başlık ve token ASLA girmez.
// Destek uçlarının kendi hataları kaydedilmez (talep "destek açılamadı"yı
// bildirmek için açılmaz; asıl sorunun izini ezmesin).
import type { LastError } from '../screens/Destek/destekBaglam';
import { yalnizYol } from '../screens/Destek/destekBaglam';

let son: LastError | null = null;

export function recordLastError(p: {
  method: string | undefined;
  url: string | undefined;
  status: LastError['status'];
  message: string;
}): void {
  const path = yalnizYol(p.url);
  if (path.includes('/destek/')) return;
  son = {
    at: new Date().toISOString(),
    method: (p.method ?? 'GET').toUpperCase(),
    path,
    status: p.status,
    message: p.message,
  };
}

export function lastError(): LastError | null {
  return son;
}
