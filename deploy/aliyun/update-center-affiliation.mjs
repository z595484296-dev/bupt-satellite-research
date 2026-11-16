// Run only while the website process using this DATA_DIR is stopped.
// This updates website settings only, never FlowUs source records or credentials.
import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw new Error('Pass the absolute, offline data directory.');
const file = path.join(directory, 'content.json');
const data = JSON.parse(await readFile(file, 'utf8'));
if (!['北京邮电大学', '北京邮电大学经济管理学院'].includes(data.settings.affiliation))
  throw new Error('Unexpected affiliation; no changes made.');
const settings = {
  ...data.settings,
  affiliation: '北京邮电大学经济管理学院',
  aboutIntro: data.settings.aboutIntro.replace('依托北京邮电大学多学科优势', '依托北京邮电大学经济管理学院'),
  aboutBody: data.settings.aboutBody.replace('在经管学院大力支持下', '在北京邮电大学经济管理学院大力支持下'),
};
if (JSON.stringify(settings) === JSON.stringify(data.settings)) {
  console.log('College affiliation already applied.');
} else {
  const backupDir = path.join(directory, 'backups');
  await mkdir(backupDir, { recursive: true });
  await copyFile(file, path.join(backupDir, `content-before-affiliation-${Date.now()}.json`));
  const temp = file + '.affiliation.tmp';
  await writeFile(temp, JSON.stringify({ ...data, settings, version: data.version + 1 }, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
  console.log(JSON.stringify({ affiliation: settings.affiliation, entriesPreserved: data.entries.length }));
}
