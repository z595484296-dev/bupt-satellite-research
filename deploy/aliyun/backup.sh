#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/satellite-center-backup.lock
flock -n 9 || exit 0
destination=/var/backups/satellite-center
install -d -m 0700 "$destination"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pending="$destination/.backup-$stamp.tar.gz.partial"
archive="$destination/backup-$stamp.tar.gz"
trap 'rm -f "$pending"' EXIT
# JSON records are written atomically by the application. Preserve the source
# copies separately from daily operational snapshots to avoid nested backups.
tar --exclude='var/lib/satellite-center/data/backups' \
    --exclude='var/lib/satellite-center/data/flowus-requests' \
    --exclude='*.lock' \
    -czf "$pending" -C / var/lib/satellite-center etc/satellite-center
tar -tzf "$pending" >/dev/null
mv "$pending" "$archive"
find "$destination" -maxdepth 1 -type f -name 'backup-*.tar.gz' -mtime +14 -delete
printf 'Created %s\n' "$archive"
