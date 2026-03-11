# CaveScore — Specification

## Overview

CaveScore is a browser extension (Chrome / Firefox) that enhances the wine browsing experience on [leclercdrive.fr](https://www.leclercdrive.fr). It overlays Vivino ratings directly on each wine listing and provides a dedicated ranking view to identify the best-rated bottles available at your local store.

---

## Goals

- Display Vivino ratings inline on every wine card on leclercdrive.fr, without any manual action from the user.
- Provide a ranking view (extension popup or injected panel) listing all wines on the current page sorted by Vivino score.
- Require zero configuration: the extension reads the user's active store from their existing leclercdrive session.

---

## Target Platform

- **Browser:** Chrome (primary), Firefox (secondary)
- **Target website:** leclercdrive.fr — wine category pages only (requires user to be logged in)
- **Vivino:** unofficial public search API (no auth required)

## Constraints & Decisions

- The user must be logged into leclercdrive for the extension to function (site requires auth).
- The ranking panel shows only wines from the **current page** — no cross-page accumulation.
- The extension activates only on **wine category pages** (not search results or other categories).
- Badge and popup styling follows the **leclercdrive visual identity** (white, red, clean sans-serif).
- Wine pages use **infinite scroll** — the content script uses a `MutationObserver` to detect newly loaded cards and inject badges progressively as the user scrolls.
- Badges appear **as soon as a card is loaded** — no waiting for the full page.
- Badge position: **top-right** of each wine card.
- If no Vivino match is found: display a grey **"NR"** badge (Non Renseigné).
- Vivino API endpoint to be validated during a dedicated exploration phase before implementation.

---

## Features

### F1 — Inline Rating Overlay

- On any leclercdrive wine listing page, each wine card gets a small badge showing:
  - Vivino score (e.g. ⭐ 4.2)
  - Number of ratings (e.g. 1 243 notes)
  - Optional: Vivino rating label (e.g. "Very Good")
- Badge is injected directly into the wine card DOM.
- If no Vivino match is found, show a grey **"NR"** (Non Renseigné) badge.
- Ratings are fetched asynchronously — cards render progressively.

### F2 — Ranking Panel

- Accessible via the extension popup icon in the browser toolbar.
- Displays all wines found on the current leclercdrive page, sorted by Vivino score (descending).
- Each entry shows: wine name, price, Vivino score, and a direct link to the product page.
- One-click to open the wine's Vivino page or the leclercdrive product page.

### F3 — Store Auto-detection

- The extension reads the active store from the leclercdrive session (cookie or page DOM).
- No manual store configuration required.
- Store context is used to ensure wine availability is scoped to the user's actual store.

---

## Technical Architecture

### Extension Structure

```
cavescore/
├── manifest.json          # Extension manifest (MV3)
├── content/
│   ├── content.js         # Injected into leclercdrive pages
│   └── content.css        # Badge styles
├── popup/
│   ├── popup.html         # Ranking panel UI
│   ├── popup.js           # Ranking logic
│   └── popup.css          # Popup styles
├── background/
│   └── service-worker.js  # Vivino API calls (avoids CORS)
└── icons/
    └── ...
```

### Data Flow

1. `content.js` detects wine cards on the current leclercdrive page.
2. For each wine, it extracts the name and sends it to `service-worker.js`.
3. `service-worker.js` queries the Vivino search API and returns the best match.
4. `content.js` injects the rating badge into the card.
5. The popup queries the same cached data to render the ranked list.

### Vivino API

- Endpoint: `https://www.vivino.com/api/explore/explore?q=<wine_name>&language=fr`
- No authentication required.
- Match confidence: fuzzy name matching (wine name + vintage year if available).
- Results are cached per session to avoid redundant calls.

### Matching Strategy

- Normalize both wine names (lowercase, remove accents, strip punctuation).
- Match on: producer name + wine name + vintage year.
- Use a confidence threshold — only display rating if match score is above threshold.
- Fallback: show "–" if no confident match found.

---

## UI / UX

### Badge Design

- Small pill in the **top-right** of each wine card.
- Color-coded by score:
  - 🟢 ≥ 4.0 — green
  - 🟡 3.5–3.9 — yellow
  - 🔴 < 3.5 — red
  - ⚪ no match — grey "NR"
- Appears progressively as cards load (MutationObserver), not all at once.
- Minimal footprint — does not interfere with leclercdrive's own UI.
- Visual style follows leclercdrive's identity: white background, red accent, clean sans-serif.

### Popup / Ranking Panel

- Clean list layout, sorted by score descending.
- Shows: rank, wine name, price, Vivino score + number of ratings.
- Filter toggle: show only wines with a confirmed Vivino match.
- "Open on Vivino" and "View on Drive" links per entry.

---

## Out of Scope (v1)

- Support for other supermarket drive websites.
- User accounts or cross-device sync.
- Price history or deal alerts.
- Cellar tracking / personal ratings.

---

## Future Ideas (v2+)

- Score/price ratio sorting (best value wines).
- Filter by wine type (red, white, rosé, sparkling).
- Wishlist or "to try" list saved locally.
- Support for other drive chains (Carrefour Drive, etc.).
