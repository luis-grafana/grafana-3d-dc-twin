#!/usr/bin/env bash
# Run this to see why the plugin might not show in Grafana.
# Run from plugin root: ./scripts/check-plugin.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 1. Container on port 3010? ==="
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Image}}" | head -20
echo ""
echo "Look for a row with 3010 in Ports. Container name should be 'grafana-3d-dc-twin'."
echo ""

CONTAINER="grafana-3d-dc-twin"
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo ">>> Container 'grafana-3d-dc-twin' is NOT running. Run: ./scripts/deploy-from-scratch.sh"
  exit 1
fi

echo "=== 2. Plugin folder inside container? ==="
docker exec "$CONTAINER" ls -la /var/lib/grafana/plugins/grafana-3d-dc-twin/ 2>/dev/null || echo ">>> Plugin directory missing or empty!"
echo ""

echo "=== 3. plugin.json and dist/module.js exist? ==="
docker exec "$CONTAINER" test -f /var/lib/grafana/plugins/grafana-3d-dc-twin/plugin.json && echo "  plugin.json: OK" || echo "  plugin.json: MISSING"
docker exec "$CONTAINER" test -f /var/lib/grafana/plugins/grafana-3d-dc-twin/dist/module.js && echo "  dist/module.js: OK" || echo "  dist/module.js: MISSING"
echo ""

echo "=== 4. Unsigned plugin allowed? ==="
docker exec "$CONTAINER" env | grep GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS || echo ">>> GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS not set!"
echo ""

echo "=== 5. Last Grafana log lines (plugin load) ==="
docker logs "$CONTAINER" 2>&1 | grep -i "grafana-3d-dc-twin\|Plugin registered\|unsigned\|plugin.*load" | tail -10
echo ""
echo "If you see 'Plugin registered pluginId=grafana-3d-dc-twin', the plugin loaded. Open http://localhost:3010 and try hard refresh (Cmd+Shift+R), filter by Panels in Administration → Plugins."
