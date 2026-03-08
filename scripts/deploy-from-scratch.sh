#!/usr/bin/env bash
# Teardown and redeploy Grafana with the 3D plugin from scratch.
# Run from the plugin root: ./scripts/deploy-from-scratch.sh

set -e
cd "$(dirname "$0")/.."

echo "=== Stopping and removing containers ==="
docker compose down

echo "=== Installing dependencies and building plugin ==="
npm install
npm run build

echo "=== Starting Grafana with plugin ==="
docker compose up -d

echo ""
echo "Done. Wait ~15 seconds, then open http://localhost:3010"
echo "Log in (admin/admin), then check Administration → Plugins or Add panel → Grafana3d-Panel."
