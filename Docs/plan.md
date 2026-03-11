# Plan d'implémentation — CaveScore

## Contexte

CaveScore est une extension Chrome/Firefox (MV3) qui injecte les notes Vivino sur les pages vins de leclercdrive.fr. Le `manifest.json` est en place. Il faut créer 6 fichiers de code + les icônes. Ce plan couvre l'ordre d'implémentation, les interfaces entre composants, le protocole de messages et la stratégie de vérification.

---

## Ordre d'implémentation

```
Phase 1 — Réseau ✅
  [1] background/service-worker.js   ✅
  [2] content/content.css            ✅
  [+] manifest.json host_permissions corrigé (*.leclercdrive.fr)

Phase 2 — Script de contenu ✅
  [3] content/content.js             ✅

Phase 3 — Popup
  [4] popup/popup.html
  [5] popup/popup.css
  [6] popup/popup.js                 ← dépend de chrome.storage.local (écrit par content.js)

Phase 4 — Assets
  [7] icons/icon16.png, icon48.png, icon128.png
```

Après chaque phase : charger l'extension dans Chrome (`chrome://extensions` → Load unpacked) et vérifier l'absence d'erreurs.

---

## Détail des fichiers

### [1] `background/service-worker.js`

Responsabilités : proxy API Vivino (évite CORS), cache en mémoire, routeur de messages.

**Fonctions clés :**
```
normalizeWineName(name)     → lowercase, sans accents (NFD + regex), sans ponctuation
computeMatchScore(q, c)     → token overlap, retourne 0–1 ; bonus si millésime match
fetchVivino(wineName)       → vérifie cache Map → GET Vivino API → sélectionne meilleur match si score > 0.6 → cache → retourne résultat ou null
```

**Cache :**
```js
const vivinoCache = new Map();
// clé : normalizeWineName(wineName)
// valeur : { score, ratingsCount, vivinoUrl, wineName } | null
```
Le SW peut s'endormir (MV3) — le cache `Map` est perdu, les requêtes suivantes refetchent l'API. Acceptable en v1.

**Listener messages :**
```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_VIVINO") {
    fetchVivino(msg.wineName).then(sendResponse);
    return true; // CRITIQUE: maintient le canal ouvert pour réponse async
  }
});
```

**API Vivino :**
```
GET https://www.vivino.com/api/explore/explore?q=<encoded>&language=fr
```

---

### [2] `content/content.css`

Classes à définir :
```
.cs-badge              → position: absolute, top: 8px, right: 8px, pill z-index: 10
.cs-badge--green       → score ≥ 4.0  (#27ae60)
.cs-badge--yellow      → score 3.5–3.9 (#f39c12)
.cs-badge--red         → score < 3.5  (#E2001A)
.cs-badge--nr          → aucun match  (#9b9b9b)
.cs-badge--loading     → skeleton/spinner pendant le fetch
.cs-badge__score       → texte score (font-size: 12px, bold)
.cs-badge__count       → texte nb notes (font-size: 10px, opacity: 0.8)
```
La carte parente doit avoir `position: relative` — à appliquer via JS si absent.

---

### [3] `content/content.js`

**⚠️ Priorité avant de coder :** valider les sélecteurs CSS sur leclercdrive (voir section Sélecteurs).

**Fonctions clés :**
```
isWinePage()            → vérifie window.location.pathname / URL contient "/vins"
extractWineData(card)   → retourne { name, price, productUrl, cardElement }
injectLoadingBadge(card)→ insère .cs-badge.cs-badge--loading top-right
updateBadge(card, res)  → remplace le loading badge par le badge final coloré
processCard(card)       → si non traité (data-cs-processed absent) → marque → loading → sendMessage → updateBadge + stocke dans wineResults
observeNewCards()       → MutationObserver sur le conteneur liste (subtree: true, childList: true)
init()                  → if (!isWinePage()) return → traite cartes existantes → observe
```

**Store partagé avec popup :**
```js
// Après chaque résolution, mise à jour du storage:
chrome.storage.local.set({ cs_results: wineResults });
// wineResults = [{ name, price, productUrl, score, ratingsCount, vivinoUrl }]
```

---

### [4] `popup/popup.html`

Structure :
```html
<header>       → logo/titre CaveScore
<div#controls> → toggle filtre "match seulement" + compteur
<ul#ranking>   → liste générée par popup.js (overflow-y: auto, max-height: 480px)
<footer>       → lien "Ouvrir leclercdrive"
```
Dimensions : `width: 380px`.

---

### [5] `popup/popup.css`

Classes clés :
```
.wine-entry           → ligne, flex row, align-items: center
.wine-entry__rank     → numéro gras, couleur accent #E2001A
.wine-entry__name     → flex-grow, text-overflow: ellipsis
.wine-entry__price    → aligné droite
.wine-entry__score    → badge couleur (mêmes couleurs que content.css)
.wine-entry__links    → 2 icones liens (Vivino + Drive)
.filter-toggle        → checkbox + label
```

---

### [6] `popup/popup.js`

**Fonctions clés :**
```
loadResults()          → chrome.storage.local.get("cs_results") → retourne [] si vide
sortResults(results)   → tri décroissant par score ; NR (score === null) en fin
renderList(results, filterMatchOnly) → vide #ranking → crée <li> par résultat
applyFilter(checked)   → re-render avec filterMatchOnly
init()                 → loadResults → sortResults → renderList → attacher toggle listener
```

---

## Protocole de messages

### `content.js` → `service-worker.js`

```js
// Requête
{ type: "FETCH_VIVINO", wineName: "Château Margaux 2018" }

// Réponse
{ matched: true, score: 4.2, ratingsCount: 1243, vivinoUrl: "https://www.vivino.com/wines/..." }
// ou
{ matched: false }
```

**Note :** Pas de communication directe popup → content script. Le vecteur est `chrome.storage.local` (écrit par content.js, lu par popup.js).

---

## Domaine et URL réels

Le domaine réel est `fd5-courses.leclercdrive.fr` (sous-domaine variable selon le magasin).
**Le `manifest.json` doit être mis à jour :** remplacer `https://www.leclercdrive.fr/*` par `https://*.leclercdrive.fr/*`.

### Détection de page vins

Pattern URL confirmé :
```
https://fd5-courses.leclercdrive.fr/magasin-XXXXX/rayon-289555-Vins.aspx
```

Rayons à activer :
- `rayon-289555` → Vins
- `rayon-284518` → Champagnes & mousseux

Détection dans `isWinePage()` :
```js
const WINE_RAYON_IDS = ["289555", "284518"];
return WINE_RAYON_IDS.some(id => window.location.pathname.includes(`rayon-${id}`));
```

---

## Sélecteurs CSS — Confirmés depuis `Docs/vinleclercwebpage.html`

| Élément | Sélecteur confirmé |
|---|---|
| Conteneur liste produits | `div#divWCRS310_ProductsList` |
| Carte vin individuelle | `li.liWCRS310_Product[data-vignette="disponible"]` |
| Nom du vin | `p.pWCRS310_Desc > a.aWCRS310_Product` (texte concaténé ligne1 + ligne2) |
| Prix (partie entière) | `p.pWCRS310_PrixUnitairePartieEntiere` dans `div.divWCRS310_PrixUnitaire` |
| Prix (partie décimale) | `p.pWCRS310_PrixUnitairePartieDecimale` |
| Lien produit | `a.aWCRS310_Product` — pas de `href` dans le template, à confirmer en live |

**Extraction nom :**
```js
const name = card.querySelector('.pWCRS310_Desc .aWCRS310_Product')
  ?.textContent.replace(/\s+/g, ' ').trim();
```

**Reconstruction prix :**
```js
const e = card.querySelector('.pWCRS310_PrixUnitairePartieEntiere')?.textContent.trim();
const d = card.querySelector('.pWCRS310_PrixUnitairePartieDecimale')?.textContent.trim();
const price = e ? `${e},${d ?? '00'}€` : null;
```

**⚠️ Lien produit :** `a.aWCRS310_Product` sans `href` — lien géré via popin JS. À confirmer en live ; fallback : `window.location.href` comme URL Drive.

---

## Vérification manuelle

### Extension installée
- [ ] `chrome://extensions` → Load unpacked → `src/` → aucune erreur rouge
- [ ] Icône CaveScore visible dans la barre d'outils

### Service Worker
- [ ] Console SW → envoyer `{ type: "FETCH_VIVINO", wineName: "Bordeaux rouge" }` → réponse avec score
- [ ] 2e appel identique → réponse instantanée (hit cache)

### Badges inline
- [ ] Naviguer sur page rayon vins → badges `.cs-badge` visibles
- [ ] Au moins un badge vert/jaune/rouge et un NR
- [ ] Scroll → badges progressifs sur nouvelles cartes
- [ ] `chrome.storage.local.get('cs_results', console.log)` → tableau non vide

### Popup
- [ ] Clic icône → liste triée par score décroissant
- [ ] Toggle filtre fonctionne
- [ ] Liens Vivino + Drive s'ouvrent dans nouvel onglet

### Edge cases
- [ ] Page non-vins → aucun badge, aucune erreur console
- [ ] Vin obscur → badge NR
- [ ] Scroll rapide → pas de doublons (data-cs-processed)
- [ ] Firefox (via `web-ext run`) → même comportement

---

## Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Sélecteurs CSS leclercdrive changent | Haut | Préférer `data-*` attrs, documenter en tête de content.js |
| API Vivino bloque les requêtes CORS | Haut | Toutes les requêtes passent par le SW |
| SW s'endort, cache perdu | Moyen | Re-fetch transparent, aucun état critique perdu |
| Matching imprécis (faux positifs) | Moyen | Threshold 0.6, afficher NR plutôt qu'un score erroné |
| Infinite scroll non détecté | Moyen | Observer le body ou conteneur racine avec `subtree: true` |
| cs_results multi-onglets incohérent | Bas | Acceptable v1, limitation documentée |
