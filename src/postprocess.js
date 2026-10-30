// Post-download steps: extract zip, copy to folder, delete archive.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; ; i++) { const c = path.join(dir, `${name} (${i})${ext}`); if (!fs.existsSync(c)) return c; }
}

// Zip-slip safe extraction. Returns number of files written.
function extractZip(file, dest) {
  const zip = new AdmZip(file);
  const root = path.resolve(dest) + path.sep;
  let n = 0;
  for (const e of zip.getEntries()) {
    const out = path.resolve(dest, e.entryName);
    if (!out.startsWith(root)) throw new Error(`Blocked unsafe path in archive: ${e.entryName}`);
    if (e.isDirectory) { fs.mkdirSync(out, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
    n++;
  }
  return n;
}

// preset: { extract?: bool, extractTo?: dir, copyTo?: dir, deleteArchive?: bool }
async function run(file, preset, log) {
  if (!preset) return;
  const isZip = /\.zip$/i.test(file);
  if (preset.extract) {
    if (!isZip) log(`Not a .zip, skipped extract (7z/rar are not supported yet): ${path.basename(file)}`);
    else {
      const to = preset.extractTo || path.dirname(file);
      fs.mkdirSync(to, { recursive: true });
      log(`Extracted ${extractZip(file, to)} files to ${to}`);
    }
  }
  if (preset.copyTo) {
    fs.mkdirSync(preset.copyTo, { recursive: true });
    const dest = uniquePath(path.join(preset.copyTo, path.basename(file)));
    fs.copyFileSync(file, dest);
    log(`Copied to ${dest}`);
  }
  if (preset.deleteArchive && (preset.extract || preset.copyTo)) {
    fs.unlinkSync(file);
    log('Deleted archive');
  }
}

module.exports = { run, uniquePath, extractZip };
