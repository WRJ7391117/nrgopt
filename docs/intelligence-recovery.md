# Local backup and recovery

This procedure covers the local Supabase Docker validation environment. It does not prove cloud backup, restoration to another host, or a 24-hour recovery point. Keep backup artifacts, keys and runtime configuration outside the public repository.

## Encrypted backup

Stop application writes and archive workers for the local stack during the database and file-volume copy. `pg_dump` gives the database a consistent snapshot; a database dump and a changing file volume are not a single atomic snapshot.

Provide these environment variables, then run `node scripts/intelligence-local-backup.cjs`:

- `NRGOPT_BACKUP_DB_CONTAINER`: local Supabase database container.
- `NRGOPT_BACKUP_STORAGE_CONTAINER`: local Storage container with its named volume mounted at `/mnt`.
- `NRGOPT_BACKUP_DIR`: new absolute directory outside the repository; parent must exist.
- `NRGOPT_BACKUP_KEY_FILE`: absolute path to a private file containing 32 random binary bytes, outside the backup directory. Retain a separate secure copy of this key; without it the backup cannot be restored.

The script saves AES-256-GCM encrypted database and Storage archives, verifies each by decrypting its disk readback, and writes a hash manifest only after both succeed. It copies no runtime environment files or plaintext keys. A failed run leaves an incomplete directory for diagnosis, without a completed manifest. The current implementation buffers each archive and is limited to 64 MiB, suitable for the small local validation stack.

Copy the encrypted files and manifest to independent storage. Two directories, or even two filesystems on the same Mac, do not prove an independent disaster-recovery copy. Keep the recovery key separately; do not put it alongside either backup copy.

## Restore to an isolated target

1. Verify encrypted hashes against the manifest, decrypt using the recorded AES-GCM layout, and verify plaintext hashes. Never restore over the source database.
2. Create a fresh database. Recreate the required cluster roles and the `extensions` schema with `uuid-ossp` and `pgcrypto`. The tested same-cluster exercise reused existing Supabase roles; cold-cluster role recreation is still unverified.
3. Restore `database.dump` with `pg_restore --exit-on-error` using a role allowed to restore Supabase ownership and ACLs. In the local stack, `supabase_admin` required the existing local database password. Do not use `--clean` against a populated target.
4. Restore `storage.tar` into a fresh named volume using **GNU tar `--xattrs --xattrs-include='*'`**. Use the same flags when creating the archive. BusyBox tar loses the extended attributes used by Supabase Storage; file bytes alone can match while authenticated downloads fail with `ENODATA`.
5. Start isolated Auth, Storage and PostgREST instances against the new database and volume, with separately supplied runtime secrets. Expose only loopback ports. The application recovery scope uses PostgREST `PGRST_DB_SCHEMAS=public`; GraphQL and other platform schemas are not included.
6. Start the application with writes disabled. Compare table counts and source relationships, log in, open a private page, download originals and compare their SHA-256 hashes. Verify anonymous API access is denied. Authentication keys, provider-encryption keys and runtime configuration must match the intended recovered environment.
7. Remove only the temporary restored services, database and volume once verification is recorded. Retain encrypted copies, manifest and redacted report privately.

The September 2026 local exercise restored 50 application/Auth/Storage tables, successfully logged in and opened the read-only page, and downloaded five originals with matching hashes. The encrypted copy was restored from a different local filesystem. Production database credentials, cross-host recovery, independent key custody and scheduled backup retention remain separate acceptance items.
