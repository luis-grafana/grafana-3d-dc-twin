# Verify the 3D plugin is loaded in Grafana

Run these from your Mac terminal.

## 1. See what is running on port 3010

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Look for a row that shows **3010** in the Ports column. Note the **container name**.

- If the name is **grafana-3d-dc-twin** → that is the Grafana from this plugin's compose; go to step 2.
- If the name is **anything else** (e.g. `grafana`, `dc_simulator-grafana-1`) → that Grafana does **not** have this plugin. You must:
  1. Stop it: `docker stop <that-container-name>`
  2. Start the plugin's Grafana:
     ```bash
     cd /path/to/plugins/grafana-3d-dc-twin
     npm run build
     docker compose up -d
     ```
  3. Wait a few seconds, then open http://localhost:3010 and check again.

## 2. Confirm the plugin is inside the container (only if container is grafana-3d-dc-twin)

```bash
docker exec grafana-3d-dc-twin ls -la /var/lib/grafana/plugins/grafana-3d-dc-twin/
```

You should see `plugin.json` and a `dist` folder.

```bash
docker exec grafana-3d-dc-twin ls /var/lib/grafana/plugins/grafana-3d-dc-twin/dist/
```

You should see `module.js`.

```bash
docker exec grafana-3d-dc-twin env | grep GF_PLUGINS
```

You should see: `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=grafana-3d-dc-twin`

## 3. Restart Grafana and refresh the browser

```bash
docker restart grafana-3d-dc-twin
```

Wait ~10 seconds, then:

- Open http://localhost:3010 (or use a new incognito window).
- Hard refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows).
- Go to **Administration** → **Plugins and data** → **Plugins**.
- Use the filter/category and set it to **Panels** (or **All**), and search for **3d** or **Grafana3d**.

You should see **Grafana3d-Panel** (or similar). You can also go to any dashboard → **Add** → **New panel** and in the visualization list look for **Grafana3d-Panel** / **3D Data Center**.

## 4. If the plugin still does not appear

- Confirm you are using **http://localhost:3010** (plugin's Grafana; dc_simulator may use 3000).
- Confirm the container on 3010 is **grafana-3d-dc-twin** (step 1).
- Check Grafana logs:  
  `docker logs grafana-3d-dc-twin 2>&1 | grep -i "grafana-3d-dc-twin\|Plugin registered\|unsigned"`  
  You should see a line like `Plugin registered pluginId=grafana-3d-dc-twin`.
