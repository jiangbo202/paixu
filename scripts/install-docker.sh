#!/bin/sh
set -eu
docker compose build
docker compose run --rm game node scripts/admin.mjs init
docker compose up -d
