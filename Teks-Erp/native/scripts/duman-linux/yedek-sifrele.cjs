// Sahte yedek aracı (güncelleyicinin çağırdığı üç alt komut, aynı bayraklar). ŞİFRELEMEZ: başlık + gövde; `coz`
// başlığı ve alıcı listesini ölçer. Duman yedeğin AKIŞINI (al → sar → geri yükle) ölçer, kriptoyu değil.
"use strict";
const fs = require("fs");
const path = require("path");

const [komut, ...arg] = process.argv.slice(2);
const bayrak = (ad) => arg.flatMap((a, i) => (a === ad ? [arg[i + 1]] : []));
const tek = (ad) => {
  const v = bayrak(ad);
  if (v.length !== 1 || !v[0]) throw new Error(`${ad} tek değer ister`);
  return v[0];
};
const BASLIK = "TKENC-DUMAN\n";
if (komut === "anahtar-uret") {
  const ad = tek("--ad");
  fs.writeFileSync(path.join(tek("--dizin"), `${ad}.tkpub`), `tkpub1:DUMAN-${ad}\n`);
  fs.writeFileSync(tek("--ozel-cikti"), `tksec1:DUMAN-${ad}\n`, { mode: 0o600 });
} else if (komut === "sifrele") {
  const alicilar = bayrak("--alici");
  if (alicilar.length === 0) throw new Error("alıcı yok");
  const satir = JSON.stringify(alicilar.map((a) => fs.readFileSync(a, "utf8").trim())) + "\n";
  fs.writeFileSync(tek("--cikti"), Buffer.concat([Buffer.from(BASLIK + satir), fs.readFileSync(tek("--girdi"))]));
} else if (komut === "coz") {
  const anahtar = fs.readFileSync(tek("--anahtar"), "utf8").trim().replace("tksec1:", "tkpub1:");
  const b = fs.readFileSync(tek("--girdi"));
  const nl = b.indexOf(10, BASLIK.length);
  if (b.subarray(0, BASLIK.length).toString() !== BASLIK || nl < 0) throw new Error("başlık yok");
  if (!JSON.parse(b.subarray(BASLIK.length, nl).toString()).includes(anahtar)) throw new Error("anahtar alıcı değil");
  fs.writeFileSync(tek("--cikti"), b.subarray(nl + 1));
} else {
  throw new Error(`bilinmeyen komut: ${komut}`);
}
