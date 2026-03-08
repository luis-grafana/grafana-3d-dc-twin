# Deploy from scratch (clean teardown + redeploy)

Use this when you want to remove all containers and start fresh with Grafana and the 3D plugin.

---

## Step 1: Go to the plugin directory

```bash
cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin
```

---

## Step 2: Stop and remove this project’s containers

```bash
docker compose down
```

This stops and removes the `grafana-3d-dc-twin` container (and any other services defined in this compose). Use `docker compose down -v` only if you also want to remove named volumes (default is to keep them).

---

## Step 3: Free port 3000 (if something else is using it)

If another Grafana or app is bound to port 3000, stop it so this Grafana can use it:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Find the container that lists `3000` in Ports, then:

```bash
docker stop <CONTAINER_NAME>
```

(Optional) To remove that container:

```bash
docker rm <CONTAINER_NAME>
```

---

## Step 4: Build the plugin

```bash
npm install
npm run build
```

You should see the build finish and `dist/module.js` and `dist/plugin.json` updated.

---

## Step 5: Start Grafana with the plugin

```bash
docker compose up -d
```

Wait 10–15 seconds for Grafana to start and load the plugin.

---

## Step 6: Open Grafana and check the plugin

1. Open **http://localhost:3010** in your browser (plugin's Grafana; dc_simulator may use 3000).
2. Log in (default: `admin` / `admin`).
3. Confirm the plugin:
   - **Administration** → **Plugins and data** → **Plugins** → filter by **Panels** or search for **3d** → you should see **Grafana3d-Panel**.
   - Or create a dashboard → **Add** → **New panel** → in the visualization list choose **Grafana3d-Panel** (3D Data Center).

---

## One-shot script (all steps in one go)

From the plugin directory you can run:

```bash
cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin
docker compose down
docker stop grafana-3d-dc-twin 2>/dev/null || true
npm install && npm run build
docker compose up -d
echo "Wait ~15 seconds, then open http://localhost:3010"
```

Then open **http://localhost:3010** and verify the plugin as in Step 6.
