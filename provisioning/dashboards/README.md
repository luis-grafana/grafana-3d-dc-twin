# Provisioned dashboards

Grafana loads any `*.json` file in this folder as a **provisioned dashboard**. Provisioned dashboards are read-only in the UI (you can't delete them—they're managed by this config).

- **Currently:** No `.json` files are here, so no dashboards are auto-created. Create your own dashboards in the UI.
- **Sample:** `dashboard.json.example` is a sample dashboard with two 3D panels. To provision it, copy it to `dashboard.json` and restart Grafana:
  ```bash
  cp dashboard.json.example dashboard.json
  docker restart grafana-3d-dc-twin
  ```
