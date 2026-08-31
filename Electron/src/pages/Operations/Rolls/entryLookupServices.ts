// =============================================================================
// entryLookupServices — "Ekleyen" / "Giriş İstasyonu" filtre seçenekleri
// =============================================================================
// Kaynak uçlar KATALOĞU değil GERÇEK VERİYİ döner: yalnız en az bir top girmiş
// kullanıcılar (`/rolls/entry-users`) ve giriş istasyonu olmuş istasyonlar
// (`/rolls/entry-stations`). İki kazanım:
//   • "Ekleyen" için `admin:users` iznine gerek yok — o uç kullanıcı YÖNETİMİdir
//     ve Rolls sayfası kullanıcılarının çoğunda yoktur; buradaki ad zaten
//     roll:read'in gördüğü satırlarda basılıyor, yeni bilgi sızmaz.
//   • Hiç giriş yapmamış hesap/istasyon seçenek listesini şişirmez.
//
// FilterBar yalnız `getAll` çağırır (tip bilinçli `Pick<CrudService,"getAll">`);
// uçlar sayfalama almaz — liste zaten küçük (operatör sayısı), tamamı döner ve
// FilterBar kendi arama kutusuyla istemcide süzer.
// =============================================================================

// ⚠️ YOL ÖNEKİ: Electron servisleri TAM yol kullanır ("/api/..." — bkz.
// `createCrudService("/api/stations")`); apiClient.baseURL /api İÇERMEZ.
// İlk sürüm "/rolls/entry-users" çağırdı → 404 → FilterBar hatayı yutup
// "Sonuç yok." gösterdi (sahada yakalandı, 2026-08-12).
import apiClient from "@/services/apiClient";
import type { PaginatedResponse } from "@/types/api";

interface LookupRow {
  id: string;
  name: string;
  /** LookupItemBase `code?: string` bekliyor — null'ı undefined'a çeviririz. */
  code?: string;
}

function asPage(raw: Array<{ id: string; name: string; code: string | null }>): PaginatedResponse<LookupRow> {
  const rows = raw.map((r) => ({ id: r.id, name: r.name, code: r.code ?? undefined }));
  return {
    success: true,
    data: rows,
    pagination: { page: 1, pageSize: rows.length || 1, total: rows.length, totalPages: 1 },
  };
}

export const entryUserLookupService = {
  getAll: async (): Promise<PaginatedResponse<LookupRow>> => {
    const r = await apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; code: string | null }> }>(
      "/api/rolls/entry-users",
    );
    return asPage(r.data.data ?? []);
  },
};

export const entryStationLookupService = {
  getAll: async (): Promise<PaginatedResponse<LookupRow>> => {
    const r = await apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; code: string | null }> }>(
      "/api/rolls/entry-stations",
    );
    return asPage(r.data.data ?? []);
  },
};

/**
 * DEPO seçenekleri — filtre çubuğundaki "Depo" çipi için.
 *
 * ⚠️ Yol TAM yazılır (`/api/warehouses`): `apiClient.baseURL` `/api` İÇERMEZ;
 * öneksiz yol 404 alır ve FilterBar hatayı yutup "Sonuç yok." gösterir
 * (2026-08-12'de sahada tam bu yaşandı — filtre boş değildi, istek yanlış
 * kapıya gidiyordu).
 */
export const warehouseLookupService = {
  getAll: async (): Promise<PaginatedResponse<LookupRow>> => {
    const r = await apiClient.get<{
      success: boolean;
      data: Array<{ id: string; name: string; code: string | null }>;
    }>("/api/warehouses", { params: { page: 1, pageSize: 200, "filter[isActive]": "true" } });
    return asPage(r.data.data ?? []);
  },
};
