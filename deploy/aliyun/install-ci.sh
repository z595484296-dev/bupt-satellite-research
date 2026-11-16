#!/usr/bin/env bash
# Run as root after reviewing these files. Pass a PUBLIC SSH key file only.
set -euo pipefail
key_file=${1:?Usage: install-ci.sh public-key-file}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$key_file"
if ! id satellite-deploy >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/satellite-deploy --create-home --shell /bin/bash satellite-deploy
fi
install -d -m 0700 -o satellite-deploy -g satellite-deploy /var/lib/satellite-deploy/incoming
install -d -m 0755 -o root -g root /var/lib/satellite-deploy/.ssh
install -m 0755 "$script_dir/receive-release.py" /usr/local/sbin/satellite-center-receive
install -m 0755 "$script_dir/promote-release.sh" /usr/local/sbin/satellite-center-promote
printf 'restrict,command="/usr/local/sbin/satellite-center-receive" %s\n' "$(cat "$key_file")" > /var/lib/satellite-deploy/.ssh/authorized_keys
chmod 0644 /var/lib/satellite-deploy/.ssh/authorized_keys
printf 'satellite-deploy ALL=(root) NOPASSWD: /usr/local/sbin/satellite-center-promote *\n' > /etc/sudoers.d/satellite-center-deploy
chmod 0440 /etc/sudoers.d/satellite-center-deploy
visudo -cf /etc/sudoers.d/satellite-center-deploy
