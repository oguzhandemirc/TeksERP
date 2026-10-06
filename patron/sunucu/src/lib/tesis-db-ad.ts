// Tesis veritabanı ve rol ADLARI — tek kaynak (hazırlayıcı, yönlendirici, göç koşucusu, imha, bekçiler).
// Ad belirlenimlidir: aynı tesis → aynı DB. Yönlendirici adı satırdan OKUMAZ, kimlikten TÜRETİR (dizin
// bozulsa bile A'nın kimliği B'nin DB adına çıkmaz).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CENTRAL = /^[a-z_][a-z0-9_]*$/;

/** Merkez adının tavanı: `<merkez>_t<16>_destek` PostgreSQL'in 63 karakter ad sınırını aşmasın. */
export const CENTRAL_NAME_MAX = 38;

/** Merkezin kendi `app.veritabani_tesisi` değeri (tesis DB'lerinde tesis kimliği). */
export const CENTRAL_MARK = "merkez";

export function assertCentralName(name: string): string {
  if (!CENTRAL.test(name) || name.length > CENTRAL_NAME_MAX) throw new Error(`Merkez DB adı biçimsiz ya da ${CENTRAL_NAME_MAX} karakterden uzun: ${name}`);
  return name;
}

export function facilityDbName(central: string, tesisId: string): string {
  if (!UUID.test(tesisId)) throw new Error("Tesis kimliği UUID değil");
  return `${assertCentralName(central)}_t${tesisId.replace(/-/g, "").slice(0, 16).toLowerCase()}`;
}

/** Bu merkeze ait tesis DB adı mı (`<merkez>_t` + 16 onaltılık)? */
export function isFacilityDbOf(central: string, name: string): boolean {
  return name.length === central.length + 18 && name.startsWith(`${central}_t`) && /^[0-9a-f]{16}$/.test(name.slice(central.length + 2));
}

export interface FacilityRoles {
  readonly app: string;
  readonly sync: string;
  readonly support: string;
}

/** Tesis rolleri: uygulama `_uyg` · eşitleme `_esit` · destek `_destek` (göç SQL'i `current_database() || '_destek'`). */
export function facilityRoles(database: string): FacilityRoles {
  return { app: `${database}_uyg`, sync: `${database}_esit`, support: `${database}_destek` };
}

/** Bağlantı URL'inin veritabanını ve (verilirse) kimliğini değiştirir; öteki parametreler aynen kalır. */
export function withDatabase(url: string, database: string, auth?: { user: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  if (auth) {
    u.username = encodeURIComponent(auth.user);
    u.password = encodeURIComponent(auth.password);
  }
  return u.toString();
}

export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
