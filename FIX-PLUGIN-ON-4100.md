# Fix: Get the 3D plugin on an existing Grafana

Your Grafana on **another port** is probably started by a **different** Docker Compose (e.g. in `dc_simulator` or another project). The plugin and config in **this** repo only apply when you run **this** project’s `docker compose`. Follow the steps below to add the plugin to that Grafana.

---

## Step 1: Find the Grafana container

Run:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
```

Find the row for your Grafana (e.g. the port where you open it, such as **3000**). Note the **container name** (first column), e.g. `dc_simulator-grafana-1` or `grafana`.

---

## Step 2: See how that container is configured

Replace `<CONTAINER_NAME>` with the name from Step 1.

**Check environment variables:**

```bash
docker exec <CONTAINER_NAME> env | grep -E "GF_PLUGINS|GF_PATHS"
```

- If you see `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=...`, it must include:
  - `grafana-3d-dc-twin`

**Check plugins directory inside the container:**

```bash
docker exec <CONTAINER_NAME> ls -la /var/lib/grafana/plugins/
```

- If there is **no** `grafana-3d-dc-twin` folder, the plugin is not installed in this Grafana. You need to add it (Step 3).

---

## Step 3: Add the plugin and allow list to your Grafana setup

You have to change the **same** Docker Compose (or run command) that starts the container you found in Step 1. That is usually in another project (e.g. `dc_simulator`).

### A. If you use Docker Compose (e.g. in dc_simulator)

1. Open that project’s `docker-compose.yml` (or `docker-compose.yaml`).
2. Find the **grafana** service.
3. Add or adjust **volumes** so the plugin directory from this repo is mounted:

   ```yaml
   volumes:
     # Add this line (adjust the path to your actual plugin folder):
     - /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin:/var/lib/grafana/plugins/grafana-3d-dc-twin
   ```

4. Add or set the **environment** to allow the unsigned plugin:

   ```yaml
   environment:
     GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: grafana-3d-dc-twin
   ```

5. Rebuild/restart from that project:

   ```bash
   cd /path/to/that/project   # e.g. dc_simulator
   docker compose down
   docker compose up -d
   ```

### B. If you start Grafana some other way (e.g. Docker Desktop “Run”)

1. You need to run a new container that:
   - Maps your chosen port to Grafana (e.g. `-p 3000:3000`).
   - Mounts the plugin folder:  
     `-v /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin:/var/lib/grafana/plugins/grafana-3d-dc-twin`
   - Sets:  
     `-e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=grafana-3d-dc-twin`

2. Or switch to using this repo’s Compose (see “Option: Use only this repo’s Grafana” below).

---

## Step 4: Build the plugin and restart Grafana

From this repo (so the mounted folder has a built plugin):

```bash
cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin
npm run build
```

Then restart the Grafana container you found in Step 1:

```bash
docker restart <CONTAINER_NAME>
```

Wait ~15 seconds, then open **your Grafana URL** (e.g. http://localhost:3000), hard refresh (Cmd+Shift+R), and check **Administration → Plugins and data → Plugins** (filter **Panels**, search “3d”) or **Add panel → Visualization** for “Grafana3d-Panel”.

---

## Option: Use only this repo’s Grafana (port 3000)

If you prefer to use the Grafana defined in **this** plugin repo (so everything is in one place):

1. **Stop** the current container that uses another port:
   ```bash
   docker stop <CONTAINER_NAME>
   ```

2. **Start** Grafana from this plugin repo (default port 3000):
   ```bash
   cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin
   npm run build
   docker compose up -d
   ```

3. Open **http://localhost:3000** — this will be the Grafana from this repo, with the 3D plugin loaded.

Note: This is a different Grafana instance; you may need to reconfigure data sources and dashboards.
