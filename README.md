# 3D Data Center Panel for Grafana

A Grafana panel plugin that renders your infrastructure as a **real-time 3D data center digital twin**. Racks and servers are laid out in 3D; metrics (CPU, temperature, memory, alerts) drive bar height, color, and glow. Click a server to open details or alerts in other dashboards.

This document describes **how to deploy this plugin to an existing Grafana OSS instance**. It does not cover installing or creating a Grafana instance from scratch.

---

## Prerequisites

- **Existing Grafana OSS** instance (e.g. 10.x or 11.x; plugin targets Grafana 12.3.0+).
- **Node.js** 18.x or 20.x (only needed on the machine where you build the plugin).
- A **data source** in Grafana that returns time series with one series per server (e.g. Prometheus).

---

## Deploy the plugin to an existing Grafana instance

### 1. Get the plugin source

Clone or download this repository and open a terminal in the **plugin root** (the folder that contains `package.json`).

```bash
cd grafana-3d-dc-twin
```

### 2. Install dependencies and build

From the plugin root:

```bash
npm install
npm run build
```

The built plugin is produced in the **`dist/`** folder inside the same directory. Grafana will load the plugin from this folder once it is placed in Grafana’s plugins directory.

### 3. Find Grafana’s plugins directory

Grafana loads plugins from a single **plugins** directory. You must place this plugin inside that directory.

Typical paths:

| Environment        | Plugins path |
|--------------------|--------------|
| Linux (default)    | `/var/lib/grafana/plugins` |
| macOS (Homebrew)   | `/usr/local/var/lib/grafana/plugins` or `/opt/homebrew/var/lib/grafana/plugins` |
| Windows            | See Grafana docs or `grafana.ini` (e.g. `C:\Program Files\GrafanaLabs\grafana\data\plugins`) |
| Docker (container) | `/var/lib/grafana/plugins` (map a host volume to this path if you install plugins from the host) |

To confirm or override the path on your instance, check Grafana’s config file (`grafana.ini`). Under `[paths]`, the `plugins` key is the directory Grafana uses.

### 4. Install the plugin into the plugins directory

The plugin **must** appear under a folder named exactly **`grafana-3d-dc-twin`** inside Grafana’s plugins directory (this is the plugin ID).

**Option A – Copy the whole plugin folder**

Copy the **entire** plugin folder (the one that contains `dist/`, `src/`, `package.json`, etc.) into Grafana’s plugins directory, and ensure the folder name there is `grafana-3d-dc-twin`.

Example (Linux/macOS), replacing paths with your actual ones:

```bash
cp -r /path/to/grafana-3d-dc-twin /var/lib/grafana/plugins/grafana-3d-dc-twin
```

After this, the structure should look like:

- `.../plugins/grafana-3d-dc-twin/`
  - `dist/`   (contains the built plugin)
  - `plugin.json`
  - `package.json`
  - etc.

**Option B – Symlink (handy for development)**

If you prefer not to copy, create a symlink so the existing plugin folder appears as `grafana-3d-dc-twin` inside the plugins directory:

```bash
ln -s /path/to/grafana-3d-dc-twin /var/lib/grafana/plugins/grafana-3d-dc-twin
```

Grafana will load the plugin from the linked folder (including its `dist/` output).

### 5. Allow loading the unsigned plugin

This plugin is **unsigned**. Grafana must be configured to allow it.

**Using `grafana.ini`**

Edit Grafana’s config file and ensure the `[plugins]` section contains:

```ini
[plugins]
allow_loading_unsigned_plugins = grafana-3d-dc-twin
```

If the section or key already exists, add or merge this value (multiple plugins can be comma-separated).

**Using an environment variable**

Before starting Grafana, set:

```bash
export GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=grafana-3d-dc-twin
```

If Grafana is started by systemd, a Docker run command, or another process, set this variable in that environment (e.g. in a systemd override or in the container/env configuration).

### 6. Restart Grafana

Restart the Grafana server so it rescans the plugins directory and loads the 3D panel plugin.

Examples:

- **systemd:** `sudo systemctl restart grafana-server`
- **Docker:** restart the Grafana container (e.g. `docker restart <container>` or your orchestration tool).

### 7. Verify and add the panel to a dashboard

1. Log in to Grafana and open any dashboard (or create one).
2. **Add** → **Visualization** (or **Add panel**).
3. In the visualization list, select **Grafana3d-Panel** (or the name registered by this plugin).
4. In the **Query** tab, choose a data source and a query that returns **one series per server** (e.g. Prometheus: `dc_server_cpu_ratio`, and optionally `dc_server_temperature_ratio`, `dc_server_memory_ratio`, `dc_server_alert` for full metrics).
5. Save the panel. Use the **gear icon** on the panel for options (layout, lighting, resource details URL, etc.).

After these steps, the plugin is deployed on your existing Grafana OSS instance.

---

## Panel options (quick reference)

- **Layout:** Racks per row, servers per rack, default server count (when there is no data).
- **Lighting / Appearance / Scene:** Background, lights, grid, textures.
- **Camera:** 2D/3D toggle, reset view.
- **Simulation mode:** Demo mode without a data source.
- **Resource details URL:** Optional URL for “View resource” (e.g. `/d/your-dashboard?var-server_id=${server_id}`). Leave empty to hide the link.
- **Alerts URL:** Optional URL for “View alerts”.

For alerts and details to match the 3D view, use the **same data source** on the target dashboards and pass `var-server_id` (and optionally `var-datasource`) in the URL; the panel can add these when opening links.

---

## Optional: try with the DC Simulator

To try the panel without real infrastructure, you can run a separate **DC Simulator** that exposes Prometheus metrics (`dc_server_cpu_ratio`, `dc_server_temperature_ratio`, `dc_server_memory_ratio`, `dc_server_alert`) with labels such as `server_id`, `rack`, `slot`. Point Prometheus at the simulator’s `/metrics` endpoint, add that Prometheus data source in Grafana, and use the same queries in this panel. The simulator is not part of this repository.

---

## Development

```bash
npm install
npm run build    # production build
npm run dev      # watch mode
npm run test     # unit tests
npm run lint     # lint
```

---

## Contributors

[Luis Colman](https://github.com/LuisSantosColman)

---

## License

See [LICENSE](./LICENSE).
