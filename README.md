# Running in Kentucky

A static website listing weekly run clubs, local running groups, and upcoming races for the **Lexington, Winchester, and Mt. Sterling, KY** area.

**Live site:** `https://thomas-weston-adams.github.io/runninginkentucky`

---

## What's on the site

- **Weekly calendar** — 7-day grid of group runs with times, locations, and map links. Today's column is highlighted.
- **Local running groups** — 13 clubs with Facebook & website links.
- **Daily meetups** — regulars who run every day.
- **Upcoming races** — sourced from John's Run Walk Shop and RaceRise, filterable by location or featured status.
- **Search** — live search across all clubs, events, and locations.
- **Add your club** — button links to a GitHub issue form so requests are tracked.

## Data sources (auto-filled from 3 places)

| Source | What it provides |
|--------|-----------------|
| Run Club Google Doc | Weekly schedule & local group list |
| [John's Run Walk Shop](https://www.johnsrunwalkshop.com/races) | Featured races & events |
| [RaceRise](https://www.racerise.com/upcoming-races) | Broader Kentucky race calendar |

Data refreshes automatically every 6 hours via GitHub Actions.

---

## Local development

```bash
# Build the site (copies site/ + data/ → dist/)
node scripts/build-site.mjs

# Serve locally
npx serve dist -p 3000
# then open http://localhost:3000
```

No npm install needed — no dependencies.

## Updating run club data

**Manually** (edit the Google Doc, then run):
```bash
node scripts/update-data.mjs
```

**Automatically** — the `update-data.yml` workflow runs every 6 hours. To enable live Google Doc fetching:
1. Go to your Google Doc → File → Share → Anyone with the link can view
2. Get the export URL: `https://docs.google.com/document/d/1beFCZMKbfp2xjZYN6fv-25TWa-3m3gjnWRTy1oo2LdQ/export?format=txt`
3. Add it as a repository secret: **Settings → Secrets → Actions → New secret**
   - Name: `GOOGLE_DOC_URL`
   - Value: the export URL above

---

## GitHub Pages deployment

Pushes to `main` or `master` automatically deploy via the `deploy.yml` workflow.

**First-time setup:**
1. Go to repo **Settings → Pages**
2. Set Source to **GitHub Actions**
3. Push to main — the workflow builds `dist/` and deploys it

This site deploys to `thomas-weston-adams.github.io/runninginkentucky` — completely separate from any other GitHub Pages site you have (like a resume site on a different repo).

---

## Adding your club or event

Two ways:
1. **Edit the Run Club Google Doc** — the shared document that feeds this site
2. **Open a GitHub Issue** — click "Add Your Club" on the site, or go to Issues → New Issue

---

## Instagram / social feeds

The site links to Facebook groups for each club. Full Instagram embedding requires the Instagram Basic Display API or a third-party embed service. The simplest approach is to link to each club's Instagram in their group card — open a GitHub issue to request that for your club.
