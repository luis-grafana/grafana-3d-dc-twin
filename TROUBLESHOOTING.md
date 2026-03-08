# Troubleshooting

## "Plugin not found" (after renaming)

**Symptom:** Grafana shows "Plugin … not found" for this panel. The plugin ID is now **grafana-3d-dc-twin**; the dashboard may still reference a previous panel type.

**If you already installed the plugin and restarted Grafana:** The message usually means the **dashboard** you opened still stores the old panel type. Fix it by updating that dashboard’s JSON (see step 2 below).

**Fix in two places:**

### 1. Install the plugin under grafana-3d-dc-twin

Grafana loads plugins by the **folder name** and the **`id`** inside `plugin.json`. Both must be grafana-3d-dc-twin.

1. **Remove the old plugin folder** from Grafana’s plugins directory (if it exists), e.g.:
   Remove or rename any previous plugin folder so only the current plugin is loaded.

2. **Install the current build:**
   - In Grafana’s plugins directory, create a folder named exactly **`grafana-3d-dc-twin`**.
   - Put the **built** plugin there (the folder must contain `dist/`, `plugin.json` from dist, etc.).  
   Example:
   ```bash
   # From your plugin project directory (after npm run build):
   cp -r dist/* /var/lib/grafana/plugins/grafana-3d-dc-twin/
   # Or copy the whole project folder and rename the destination to grafana-3d-dc-twin:
   cp -r . /var/lib/grafana/plugins/grafana-3d-dc-twin
   ```
   Grafana expects to find `plugin.json` at `.../plugins/grafana-3d-dc-twin/plugin.json` (or in the root of that folder). The built `plugin.json` must have `"id": "grafana-3d-dc-twin"`.

3. **Allow the unsigned plugin** in `grafana.ini`:
   ```ini
   [plugins]
   allow_loading_unsigned_plugins = grafana-3d-dc-twin
   ```

4. **Restart Grafana** so it rescans plugins.

### 2. Fix dashboards that still use the old panel type (most common cause)

**Why it still says "plugin not found":** The panel type is stored **inside each dashboard**. If the dashboard was created with a previous plugin ID, that value is saved in the dashboard JSON. Grafana then looks for a plugin with that ID, doesn’t find it (because the plugin is now `grafana-3d-dc-twin`), and shows "Plugin not found". So you must update the **dashboard**, not only the plugin install.

**Option A – Edit dashboard JSON (fixes all panels at once):**

1. Open the dashboard that shows the error.
2. Click the **gear icon** (Dashboard settings) in the top bar.
3. In the left sidebar, click **"JSON Model"** (or **"View JSON"**).
4. In the JSON, find each panel that uses this plugin and set its type to `"type": "grafana-3d-dc-twin"` (search for the panel type field and replace the value with `grafana-3d-dc-twin`).
5. Click **"Save changes"** (or "Apply") and then **Save dashboard** (disk icon or "Save" in the top bar).

**Option B – Replace the panel manually:**

1. Open the dashboard in **Edit** mode.
2. Delete the panel that shows "Plugin not found".
3. Click **"Add"** → **"Visualization"** and choose **"Grafana3d-Panel"** (or "3D Data Center").
4. Set the data source and options again, then save the dashboard.

After step 2, the plugin should load and the panels should render.

---

## "Plugin grafana-3d-dc-twin not found" (Docker)

**Symptom:** The dashboard now asks for `grafana-3d-dc-twin` but Grafana says that plugin is not found.

**Cause:** The Grafana container doesn’t see the plugin. Either the plugin isn’t mounted into the container, or it’s mounted in a way that doesn’t match what Grafana expects (a folder with `plugin.json` at the root and `dist/module.js` inside it).

**Fix:**

1. **Use this repo’s Docker Compose (recommended)**  
   You must run Docker Compose **from the plugin folder** so the plugin path is correct:
   ```bash
   cd /path/to/plugins/grafana-3d-dc-twin
   npm run build
   docker compose up -d
   ```
   If you have another Grafana container running (e.g. from Docker Desktop or another project), **stop it** so only this one is running, or use a different port.

2. **Verify the plugin is inside the container**  
   In a terminal:
   ```bash
   docker exec grafana-3d-dc-twin ls -la /var/lib/grafana/plugins/grafana-3d-dc-twin/
   ```
   You should see `plugin.json` and a `dist` folder. Then:
   ```bash
   docker exec grafana-3d-dc-twin cat /var/lib/grafana/plugins/grafana-3d-dc-twin/plugin.json | head -5
   ```
   You should see `"id": "grafana-3d-dc-twin"`. If these fail or the directory is empty, the volume mount is wrong (e.g. you didn’t run `docker compose` from the plugin folder).

3. **If you use your own Grafana container (not this compose)**  
   The plugin must be at `/var/lib/grafana/plugins/grafana-3d-dc-twin/` inside the container, with `plugin.json` and `dist/module.js` there. Mount or copy the **entire** plugin folder (the one that has `plugin.json` and `dist/` at the top level) to that path. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=grafana-3d-dc-twin` and restart the container.

4. **Restart the Grafana container** after any change to the plugin or the mount.

5. **If the logs show "Plugin registered" but the UI still says "Plugin not found"**  
   The plugin is loaded on the server; the issue is usually the **browser** or the **dashboard**. Try:
   - **Hard refresh:** Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux), or clear the site data for localhost:3000.
   - **New incognito/private window:** Open http://localhost:3000 in a private window and open the dashboard again.
   - **Fix the dashboard JSON:** Dashboard settings → JSON Model → set each panel that uses this plugin to `"type": "grafana-3d-dc-twin"` → Save.
   - **Add a new panel:** Create a new panel and in the visualization picker choose **"Grafana3d-Panel"** or **"3D Data Center"**. If it appears there, the plugin is available and the old panel just had the wrong type.

---

## Duplicate panel in Grafana (2 folders / 2 panels that select together)

**Symptom:** In "Add panel" → "Visualization", you see two entries for this plugin (e.g. two "Data Center" folders or two of the same panel). Clicking one selects the other.

**Cause:** Grafana is loading the same plugin from **two different paths**. Each path is scanned and the plugin is registered twice.

**Fix:**

1. **Find where Grafana loads plugins from**
   - **UI:** Administration → Plugins → (see "Plugin location" or paths in the docs).
   - **Config:** In `grafana.ini`, check `[paths]` → `plugins` (e.g. `plugins = /var/lib/grafana/plugins`). Also check env vars: `GF_PATHS_PLUGINS` or `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` only allows loading, it doesn’t add a path.
   - **Docker:** If you use Docker, see which directory is mounted as the plugins volume (e.g. `-v ./plugins:/var/lib/grafana/plugins`).

2. **Search for duplicate copies of this plugin**
   - Plugin ID: `grafana-3d-dc-twin`
   - Search for that folder name under:
     - Grafana’s plugins path (e.g. `/var/lib/grafana/plugins/`)
     - Your project’s `plugins/` folder (if that path is also loaded by Grafana)
     - Any other custom path you use for development (e.g. symlinks, second mount).

3. **Keep only one copy**
   - Remove or rename the **duplicate** copy so it’s no longer inside a directory Grafana scans. For example:
     - If you run Grafana from Docker and also mount your project’s `plugins/` folder, don’t copy this plugin into Grafana’s default plugins path.
     - If you use `grafana-cli plugins install` and also have the plugin in a mounted folder, uninstall the one you don’t want: `grafana-cli plugins uninstall grafana-3d-dc-twin`, then restart and use only the other copy.

4. **Restart Grafana** after removing the duplicate.

**Quick check (Linux/macOS):**
```bash
# If Grafana plugins path is /var/lib/grafana/plugins:
ls -la /var/lib/grafana/plugins/ | grep hackathon

# Or search for the plugin folder:
find /path/to/grafana -type d -name "grafana-3d-dc-twin" 2>/dev/null
```
You should have this folder in **only one** of the paths Grafana uses for plugins.
