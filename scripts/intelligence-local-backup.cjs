// Local Supabase Docker stack only. Cloud backups require a separate direct DB connection.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
function docker(args) {
  try { return execFileSync('docker', args, { maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw failure('backup_docker_failed'); }
}
function encrypt(bytes, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(bytes, key) {
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}
async function backupLocal({ databaseContainer, storageContainer, directory, keyFile }) {
  if (![databaseContainer, storageContainer].every(value => /^[a-zA-Z0-9_-]+$/.test(value || ''))
      || !path.isAbsolute(directory || '') || !path.isAbsolute(keyFile || '')) throw failure('backup_config_invalid');
  const repo = path.resolve(__dirname, '..');
  const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  const parent = await fs.realpath(path.dirname(directory));
  const target = path.join(parent, path.basename(directory));
  const keyPath = await fs.realpath(keyFile);
  if (inside(repo, target) || inside(target, keyPath)) throw failure('backup_private_path_required');
  const key = await fs.readFile(keyPath);
  if (key.length !== 32) throw failure('backup_key_invalid');
  const db = JSON.parse(docker(['inspect', databaseContainer]))[0];
  const storage = JSON.parse(docker(['inspect', storageContainer]))[0];
  const volume = storage.Mounts.find(mount => mount.Destination === '/mnt' && mount.Type === 'volume');
  if (!volume) throw failure('backup_storage_volume_missing');
  await fs.mkdir(target, { mode: 0o700 }); // Never overwrite an earlier backup.
  const entries = [
    ['database.dump', docker(['exec', databaseContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', '-n', 'public', '-n', 'auth', '-n', 'storage'])],
    // BusyBox tar drops Storage's extended attributes; use the DB image's GNU tar.
    ['storage.tar', docker(['run', '--rm', '--network', 'none', '--entrypoint', 'tar', '--mount',
      `type=volume,source=${volume.Name},target=/storage,readonly`, db.Config.Image,
      '--xattrs', '--xattrs-include=*', '-C', '/storage', '-cf', '-', '.'])]
  ];
  const manifest = { schema_version: 1, encryption: 'AES-256-GCM:12-byte-IV,16-byte-tag,ciphertext',
    scope: 'Local public, auth and storage schemas/data plus Storage file volume. Cluster roles, extensions, runtime secrets and Vault are separate.',
    created_at: new Date().toISOString(), files: [] };
  for (const [name, bytes] of entries) {
    const encrypted = encrypt(bytes, key), filename = name + '.enc';
    await fs.writeFile(path.join(target, filename), encrypted, { mode: 0o600, flag: 'wx' });
    const readback = await fs.readFile(path.join(target, filename));
    if (hash(decrypt(readback, key)) !== hash(bytes)) throw failure('backup_verify_failed');
    manifest.files.push({ name: filename, byte_size: bytes.length, plaintext_sha256: hash(bytes), encrypted_sha256: hash(readback) });
  }
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { files: manifest.files.length, verified: true };
}
if (require.main === module) backupLocal({ databaseContainer: process.env.NRGOPT_BACKUP_DB_CONTAINER,
  storageContainer: process.env.NRGOPT_BACKUP_STORAGE_CONTAINER, directory: process.env.NRGOPT_BACKUP_DIR,
  keyFile: process.env.NRGOPT_BACKUP_KEY_FILE }).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.code || 'backup_failed'); process.exitCode = 1; });
module.exports = { backupLocal, encrypt, decrypt };
