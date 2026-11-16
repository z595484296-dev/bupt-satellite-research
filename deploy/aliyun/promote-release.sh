#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
release_id=${1:-}
[[ "$release_id" =~ ^[0-9a-f]{40}-[0-9]{14}-[0-9]+$ ]] || exit 64
exec 9>/run/lock/satellite-center-deploy.lock
flock -w 120 9
incoming=/var/lib/satellite-deploy/incoming/$release_id
release=/opt/satellite-center/releases/$release_id
test -d "$incoming" && test ! -L "$incoming"
test ! -e "$release"
test -f "$incoming/server/index.mjs" && test -f "$incoming/dist/client/index.html"
previous=$(readlink -f /opt/satellite-center/current)
mv "$incoming" "$release"
chown -R --no-dereference root:satellite-center "$release"
chmod -R u=rwX,g=rX,o= "$release"
ln -s "$release" /opt/satellite-center/.next
mv -Tf /opt/satellite-center/.next /opt/satellite-center/current
healthy=false
if systemctl restart satellite-center; then
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/api/content -o /dev/null && curl -fsS http://127.0.0.1:3000/ -o /dev/null; then
      healthy=true
      break
    fi
    sleep 1
  done
fi
if ! "$healthy"; then
  ln -s "$previous" /opt/satellite-center/.rollback
  mv -Tf /opt/satellite-center/.rollback /opt/satellite-center/current
  systemctl restart satellite-center
  echo 'Release failed health checks; restored previous release.' >&2
  exit 1
fi
printf 'Live release: %s\n' "$release_id"
