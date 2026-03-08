# 3D Data Center Panel for Grafana

This panel shows your infrastructure as a **real-time 3D data center digital twin**. Racks and servers are laid out in 3D; each server’s size, color, and glow are driven by live metrics. Click a server to open its details or alerts in other Grafana dashboards.

## Requirements

- **Grafana** 12.3.0 or newer
- A data source that returns time series (e.g. Prometheus). The panel query must return **one series per server**.

## Installation (ready to follow)

1. **Build the plugin**  
   In the plugin folder (the one with `package.json`):
   ```bash
   npm install
   npm run build
   ```

2. **Copy the plugin into Grafana’s plugins directory**  
   Copy the **entire** plugin folder so it appears as:
   - `GRAFANA_PLUGINS_DIR/grafana-3d-dc-twin/`  
   Common paths:
   - Linux: `/var/lib/grafana/plugins`
   - macOS (Homebrew): `/usr/local/var/lib/grafana/plugins` or `opt/homebrew/var/lib/grafana/plugins`
   - Docker: use the volume that maps to `/var/lib/grafana/plugins` inside the container  

   Example:
   ```bash
   cp -r grafana-3d-dc-twin /var/lib/grafana/plugins/
   ```

3. **Allow the unsigned plugin**  
   In `grafana.ini` under `[plugins]` add:
   ```ini
   allow_loading_unsigned_plugins = grafana-3d-dc-twin
   ```  
   Or set the environment variable:
   ```bash
   GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=grafana-3d-dc-twin
   ```

4. **Restart Grafana** so it loads the plugin.

5. **Add the panel**  
   In a dashboard: Add → Visualization → choose **Grafana3d-Panel**. Set the data source and a query that returns one series per server (e.g. Prometheus: `dc_server_cpu_ratio`). Save.

## Data requirements

The query must return **one series per server** (e.g. 64 series = 64 servers). Each series can have labels like `server_id`, `rack`, `slot`. The panel uses the number of series to decide how many servers and racks to draw; you set “Racks per row” and “Servers per rack” in the panel settings (gear icon → Layout).

## Panel options

- **Gear icon on the panel:** Layout (racks per row, servers per rack, default server count), Lighting, Appearance, Scene, Camera, Simulation mode, Reset view.
- **Panel editor:** Same plus “Resource details URL”, “Alerts URL”, and “Max server_id for detail link” so “View resource details” and “View alerts” open the right dashboards.

## License

See [LICENSE](../LICENSE).
