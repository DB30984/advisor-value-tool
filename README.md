# Advisor Value Tool

A client analysis app that quantifies the value of advisory fees against
tax-loss harvesting, behavioral coaching, retirement optimization, estate
planning, and exit/QSBS benefits.

## Publish it to a live URL (GitHub Pages)

1. **Create a GitHub account** if you don't have one: https://github.com/join

2. **Create a new repository**
   - Go to https://github.com/new
   - Name it `advisor-value-tool` (or anything — see note below if you rename it)
   - Keep it **Public** (required for free GitHub Pages) or **Private** if you have GitHub Pro
   - Don't initialize with a README (this project already has one)

3. **Push this project to the repo.** From a terminal, inside this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/advisor-value-tool.git
   git push -u origin main
   ```

4. **Turn on GitHub Pages**
   - In your repo, go to **Settings → Pages**
   - Under "Build and deployment", set **Source** to **GitHub Actions**
   - That's it — the included workflow (`.github/workflows/deploy.yml`) will
     automatically build and publish the app on every push to `main`.

5. **Find your live URL**
   - After the Action finishes (check the **Actions** tab — takes ~1-2 min),
     your app is live at:
     `https://YOUR-USERNAME.github.io/advisor-value-tool/`

## If you rename the repo

The repo name must match the `base` path in two places, or the app will load
with broken styling:

- `vite.config.js` → `base: "/your-repo-name/"`
- `public/manifest.json` → `"start_url"` and `"scope"`

## Install it on your phone

Once it's live:

- **iPhone (Safari):** open the URL → tap Share → **Add to Home Screen**
- **Android (Chrome):** open the URL → tap the ⋮ menu → **Add to Home screen**
  (or Chrome may prompt "Install app" automatically)

It'll launch full-screen, no browser bar, with the gold bar-chart icon
included in this project.

## Updating the app later

Any time you want to change something, edit `src/App.jsx`, then:

```bash
git add .
git commit -m "Update"
git push
```

The live site updates automatically within a minute or two.

## Local development

```bash
npm install
npm run dev
```

## A note on data persistence

Right now, inputs reset when you reload the page — nothing is saved between
sessions. If you want the app to remember client data across visits (so you
can pull up a saved analysis later), that's a straightforward addition using
the browser's local storage — just ask and I can add it.
