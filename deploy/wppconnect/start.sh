#!/bin/sh
set -eu
# This container exclusively owns the mounted ANGIBELL Chromium profile.
# Clear process locks from the stopped container before launching its browser.
for lock in SingletonLock SingletonCookie SingletonSocket; do
  rm -f "/usr/src/wpp-server/userDataDir/angibell/$lock"
done
exec node dist/server.js "$@"
