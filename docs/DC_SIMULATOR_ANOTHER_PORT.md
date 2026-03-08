# Move dc_simulator Grafana to another port

So that the **3D plugin's Grafana** can use port **3000**, move dc_simulator's Grafana to a different port (e.g. **3010** or **4100**).

## Steps

1. **Open your dc_simulator project** (e.g. `~/Documents/dc_simulator` or wherever it lives).

2. **Edit the Docker Compose file** that defines the Grafana service (`docker-compose.yml` or `docker-compose.yaml`).

3. **Find the `grafana` service** and its `ports` section. It likely looks like:
   ```yaml
   grafana:
     image: grafana/grafana:latest
     ports:
       - "3000:3000"
   ```

4. **Change the host port** (first number) to something else, e.g. **3010** or **4100**:
   ```yaml
   ports:
     - "3010:3000"   # Grafana at http://localhost:3010
   ```
   or
   ```yaml
   ports:
     - "4100:3000"   # Grafana at http://localhost:4100
   ```

5. **Apply the change:**
   ```bash
   cd /path/to/dc_simulator
   docker compose down
   docker compose up -d
   ```

6. **Use the new URL** for dc_simulator's Grafana:
   - **http://localhost:3010** (or **http://localhost:4100** if you chose 4100).

7. **Start the 3D plugin's Grafana on 3000:**
   ```bash
   cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin
   ./scripts/deploy-from-scratch.sh
   ```
   Then open **http://localhost:3000** for the Grafana that has the 3D plugin.

## Summary

| Grafana              | URL                     |
|----------------------|-------------------------|
| dc_simulator         | http://localhost:3010 (or 4100) |
| 3D plugin (this repo)| http://localhost:3000   |
