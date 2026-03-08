# How to put this plugin on GitHub

## 1. Create a new repository on GitHub

1. Go to [github.com](https://github.com) and sign in.
2. Click **"+"** (top right) → **"New repository"**.
3. Set:
   - **Repository name:** e.g. `grafana-3d-datacenter-panel` (or any name you like).
   - **Description:** e.g. "Real-time 3D data center digital twin panel for Grafana".
   - **Public** (or Private if you prefer).
   - **Do not** check "Add a README" or "Add .gitignore" (you already have them).
4. Click **"Create repository"**.

## 2. Initialize Git and push from your machine

Open a terminal in the **plugin folder** (this folder) and run:

```bash
# Go to the plugin directory
cd /Users/luiscolman/Documents/3d_project/plugins/grafana-3d-dc-twin

# Initialize Git (if not already)
git init

# Add all files (node_modules and dist are ignored by .gitignore)
git add .

# First commit
git commit -m "Initial commit: 3D Data Center panel for Grafana"

# Add your GitHub repo as remote (replace YOUR_USERNAME and YOUR_REPO with yours)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push (main branch)
git branch -M main
git push -u origin main
```

Use your actual GitHub username and repository name in the `git remote add` and `git push` commands. If GitHub asks for credentials, use a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password when using HTTPS.

## 3. Optional: publish to Grafana Catalog

Later you can submit the plugin to the [Grafana Plugins catalog](https://grafana.com/grafana/plugins/) so others can install it from the UI. That process is separate and documented on Grafana’s developer site.
