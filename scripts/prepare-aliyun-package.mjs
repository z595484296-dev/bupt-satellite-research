import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [remoteManifest, fileList] = process.argv.slice(2);
if (!remoteManifest || !fileList) throw new Error('Expected remote manifest and tar file-list paths');
const previous = JSON.parse(fs.readFileSync(remoteManifest, 'utf8'));
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const name = path.posix.join(directory, entry.name);
  if (entry.isDirectory()) return walk(name);
  if (!entry.isFile()) throw new Error('Only regular files can be deployed: ' + name);
  return [name];
});
const manifest = {};
const changed = [];
for (const name of walk('dist/client')) {
  const hash = createHash('sha256').update(fs.readFileSync(name)).digest('hex');
  manifest[name] = hash;
  if (previous[name] !== hash) changed.push(name);
}
fs.writeFileSync('asset-manifest.json', JSON.stringify(manifest));
const files = ['package.json', 'package-lock.json', 'asset-manifest.json', ...walk('server'), ...changed];
fs.writeFileSync(fileList, files.join('\0') + '\0');
console.log(`Deploy ${changed.length} changed static files; reuse ${Object.keys(manifest).length - changed.length} files after SHA-256 verification.`);
