// npm run release [-- minor|major]  : bump version, build installer, copy to ./updates
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), bump = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'patch';
const run = c => execSync(c, { cwd: root, stdio: 'inherit' });
run(`npm version ${bump} --no-git-tag-version`);
run('npm run dist');
const out = path.join(root, 'updates'); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'dist')))
  if (/^latest\.yml$|Setup-.*\.exe(\.blockmap)?$/.test(f)) fs.copyFileSync(path.join(root, 'dist', f), path.join(out, f));
if (process.argv.includes('--github')) {
  const v = require('../package.json').version;
  const files = fs.readdirSync(out).map(f => path.join(out, f));
  execSync(`gh release create v${v} ${files.map(f => '"' + f + '"').join(' ')} --title "Download Hub ${v}" --notes "Download Hub ${v}"`, { cwd: root, stdio: 'inherit' });
}
console.log('Update files in', out, '\nServe with: npm run serve-updates');
