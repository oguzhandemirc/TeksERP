// latest.yml (electron-builder biçimi) — DAR ayrıştırıcı + künye bloğu yazıcı, BAĞIMLILIKSIZ.
// Yalnız yayın makinesinde (imza aracı + yayın kapısı) koşar; panel latest.yml'i electron-updater'ın js-yaml'ı ile
// okur. Kabul edilen biçim: tek satırlık skalerler, `files:` listesi, `tekserp:` eşlemi (künye bloğu). Yorum,
// sekme, çok satırlı skaler, akış sözdizimi, bilinmeyen blok → RED: kapının ONAYLADIĞI dosya ile panelin GÖRDÜĞÜ
// dosya aynı tipte aynı değerleri taşısın (tırnaklı `'12'` dizgidir, tırnaksız `12` sayıdır — js-yaml gibi).
import { fail, ok } from "./kunye-jws.mjs";
import { RELEASE_BLOCK_KEY, RELEASE_DOC_VERSION } from "./panel-kunye.mjs";

const LATEST_YML_MAX_LENGTH = 64 * 1024;
const TOP_LINE = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/;
const ITEM_FIRST = /^ {2}- ([A-Za-z][A-Za-z0-9]*): (.*)$/;
const ITEM_NEXT = /^ {4}([A-Za-z][A-Za-z0-9]*): (.*)$/;
const BLOCK_LINE = /^ {2}([A-Za-z][A-Za-z0-9]*): (.*)$/;
const PLAIN_SCALAR = /^[A-Za-z0-9_+=/.-][A-Za-z0-9_+=/.:-]*$/;
const QUOTED_SCALAR = /^'((?:[^']|'')*)'$/;
const SIZE_PATTERN = /^[1-9][0-9]{0,15}$/;
const NUMERIC_KEYS = new Set(["size", "blockMapSize", "v"]);

/** Skaler → değer: tırnaklı → dizgi; tırnaksız rakam (yalnız sayısal anahtarda) → sayı; true/false → mantıksal. */
function scalar(raw, numeric) {
  if (raw === undefined || raw === "") return null;
  const q = QUOTED_SCALAR.exec(raw);
  if (q) return { value: q[1].replace(/''/g, "'") };
  if (!PLAIN_SCALAR.test(raw)) return null;
  if (numeric && /^[0-9]+$/.test(raw)) return SIZE_PATTERN.test(raw) || raw === "0" ? { value: Number(raw) } : null;
  if (raw === "true" || raw === "false") return { value: raw === "true" };
  return { value: raw };
}

const ymlFail = (line, message) => fail("LATEST_YML_BICIM", line ? `latest.yml ${line}. satır: ${message}` : `latest.yml: ${message}`);

/** Tek satırı okur ve durumu ilerletir; tanınmazsa hata metni döner. */
function readLine(line, st) {
  let m = TOP_LINE.exec(line);
  if (m) {
    const [, key, raw] = m;
    if (st.top.has(key)) return `tekrar eden anahtar: ${key}`;
    if (raw === undefined) {
      if (key !== "files" && key !== RELEASE_BLOCK_KEY) return `desteklenmeyen blok: ${key}`;
      st.mode = key;
      st.top.set(key, null);
      if (key === RELEASE_BLOCK_KEY) st.block = {};
      return null;
    }
    const v = scalar(raw, NUMERIC_KEYS.has(key));
    if (v === null) return `desteklenmeyen değer: ${key}`;
    st.top.set(key, v.value);
    st.mode = null;
    return null;
  }
  m = st.mode === "files" ? ITEM_FIRST.exec(line) : null;
  if (m) {
    const v = scalar(m[2], NUMERIC_KEYS.has(m[1]));
    if (v === null) return `desteklenmeyen değer: ${m[1]}`;
    st.files.push(new Map([[m[1], v.value]]));
    return null;
  }
  m = (st.mode === "files" && st.files.length ? ITEM_NEXT : st.mode === RELEASE_BLOCK_KEY ? BLOCK_LINE : null)?.exec(line);
  if (!m) return "tanınmayan satır";
  const v = scalar(m[2], NUMERIC_KEYS.has(m[1]));
  const target = st.mode === "files" ? st.files[st.files.length - 1] : null;
  const exists = target ? target.has(m[1]) : Object.hasOwn(st.block, m[1]);
  if (v === null || exists) return `desteklenmeyen ya da tekrar eden değer: ${m[1]}`;
  if (target) target.set(m[1], v.value);
  else st.block[m[1]] = v.value;
  return null;
}

/** electron-builder latest.yml'i → electron-updater'ın gördüğü biçim (`version` · `files` · `path` · `sha512` · `tekserp`). */
export function parseLatestYml(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > LATEST_YML_MAX_LENGTH) return ymlFail(0, "boş ya da çok büyük");
  const st = { top: new Map(), files: [], block: null, mode: null };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" && i === lines.length - 1) continue;
    if (line === "" || /[\t\r]/.test(line) || line.includes("#")) return ymlFail(i + 1, "boş satır, sekme, CR ya da yorum desteklenmez");
    const err = readLine(line, st);
    if (err) return ymlFail(i + 1, err);
  }
  const version = st.top.get("version");
  if (typeof version !== "string") return ymlFail(0, "version satırı yok");
  if (st.files.length === 0) return ymlFail(0, "files listesi yok");
  const info = { version, files: st.files.map((f) => Object.fromEntries(f)) };
  for (const k of ["path", "sha512", "releaseDate"]) if (st.top.has(k)) info[k] = st.top.get(k);
  info[RELEASE_BLOCK_KEY] = st.block;
  return ok(info);
}

/** Künye bloğunu latest.yml'e yazar (varsa değiştirir, yoksa sona ekler); sonuç yeniden ayrıştırılarak ölçülür. */
export function withReleaseBlock(text, token) {
  const p = parseLatestYml(text);
  if (!p.ok) throw new Error(`withReleaseBlock: ${p.message}`);
  const out = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    if (line === `${RELEASE_BLOCK_KEY}:`) {
      skipping = true;
      continue;
    }
    if (skipping && line.startsWith("  ")) continue;
    skipping = false;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  out.push(`${RELEASE_BLOCK_KEY}:`, `  v: ${RELEASE_DOC_VERSION}`, `  bildirim: ${token}`, "");
  const next = out.join("\n");
  const q = parseLatestYml(next);
  if (!q.ok || q.value[RELEASE_BLOCK_KEY]?.bildirim !== token) throw new Error("withReleaseBlock: yazılan künye geri okunamadı");
  return next;
}
