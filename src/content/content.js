// CaveScore — Content Script
// Injects Vivino rating badges on wine cards across supported retailer websites.
// Site-specific logic is defined in adapters.js (loaded before this script).

let wineResults = [];
let detectedWineType = null;
let adapter = null;
let onWinePage = false;

function findAdapter() {
  const host = window.location.hostname;
  for (const [domain, config] of Object.entries(CS_ADAPTERS)) {
    if (host === domain || host.endsWith("." + domain)) {
      return config;
    }
  }
  return null;
}

// ── Wine pre-filter ─────────────────────────────────────────────────
// Used on non-wine pages to avoid useless Vivino API calls.
// On dedicated wine pages (isWinePage=true), this filter is skipped.

function isLikelyWine(name) {
  if (!name) return false;
  const n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  // ── Step 1: Hard reject — wine is never sold in grams ──
  if (/\d+\s*(g|kg)\b/.test(n)) return false;

  // ── Step 2: Hard reject — wine used as ingredient ──
  // "au vin", "et vin", "avec vin" → cooking product
  if (/\b(au|aux|et|avec|a la|al)\s+vin\b/.test(n)) return false;
  // "vin blanc et aromates", "vin rouge et légumes" → ingredient listing
  if (/\bvin\s+(blanc|rouge|rose)\s+(et|aux?|avec|,)/.test(n)) return false;

  // ── Step 3: Accept — strong wine indicators (checked BEFORE food keywords) ──

  // Product name starts with "Vin " → in a grocery store, always wine
  // (food products say "sauce au vin", "filets... vin blanc" — vin mid-name)
  if (/^vin\s/.test(n)) return true;

  // Producer/estate prefixes followed by a name
  if (/\b(chateau|domaine|clos|mas|maison)\s+[a-z]/.test(n)) return true;

  // Sparkling wine types
  if (/\b(champagne|cremant|prosecco|cava|blanquette|mousseux)\b/.test(n))
    return true;

  // Major French appellations (most common — not exhaustive)
  if (
    /\b(bordeaux|bourgogne|beaujolais|chablis|sancerre|muscadet|pouilly|meursault|pommard|gevrey|saint.emilion|pomerol|medoc|margaux|pauillac|pessac|graves|sauternes|entre.deux.mers|cotes?\s*(du|de)\s*(rhone|provence|roussillon|gascogne|bourg|blaye)|chateauneuf|gigondas|vacqueyras|crozes|hermitage|condrieu|saint.joseph|cornas|cote.rotie|bandol|minervois|corbieres|fitou|faugeres|saint.chinian|pic.saint.loup|terrasses.du.larzac|cahors|madiran|jurancon|gaillac|chinon|bourgueil|vouvray|savennieres|anjou|touraine|alsace|cote.de.provence|luberon|ventoux|costiere|tavel|rasteau|banyuls|collioure|languedoc|pays\s+d.oc)\b/.test(
      n
    )
  )
    return true;

  // Grape varieties as primary descriptor
  if (
    /\b(merlot|cabernet|chardonnay|sauvignon|pinot|syrah|shiraz|grenache|malbec|gamay|viognier|mourvedre|cinsault|tempranillo|tannat|carignan|marsanne|roussanne|vermentino|chenin|gewurztraminer|riesling|picpoul|sangiovese|nebbiolo|primitivo|zinfandel)\b/.test(
      n
    )
  )
    return true;

  // Wine-specific terms
  if (
    /\b(millesime|cuvee|brut|demi.sec|moelleux|liquoreux|vendanges?\s*tardives?|grand\s*cru|premier\s*cru|vieilles?\s*vignes?|bag.in.box|bib)\b/.test(
      n
    )
  )
    return true;

  // Wine bottle sizes (75cl, 37.5cl, 1.5L magnum)
  if (/\b(75|37[.,]5)\s*cl\b/.test(n)) return true;

  // AOP/AOC/IGP only with additional wine context
  if (
    /\b(aop|aoc|igp|vdf)\b/.test(n) &&
    /\b(rouge|blanc|rose|vin|cotes|chateau|domaine|cuvee|pays)\b/.test(n)
  )
    return true;

  // ── Step 4: Reject — food product keywords ──
  // (checked AFTER wine indicators so "Café de Paris Brut" isn't killed by "café")
  if (
    /\b(vinaigre|sauce|bouillon|marinade|filets?|terrine|pate|risotto|fondue|fromage|beurre|huile|moutarde|soupe|potage|confiture|creme|yaourt|biscuit|chocolat|gateau|farine|aromates?|legumes?|poulet|boeuf|porc|agneau|canard|saumon|thon|maquereau|sardine|crevette|biere|cidre|limonade|soda|jus|sirop|cafe|lait|riz|pizza|chips|cereale|compote|conserve|bocal|miel|olive|cornichon|condiment)\b/.test(
      n
    )
  )
    return false;

  return false;
}

// ── Badge injection ─────────────────────────────────────────────────

function injectLoadingBadge(card) {
  const style = getComputedStyle(card);
  if (style.position === "static") {
    card.style.position = "relative";
  }

  const badge = document.createElement("div");
  badge.className = "cs-badge cs-badge--loading";
  badge.innerHTML = '<span class="cs-badge__score">&hellip;</span>';
  card.appendChild(badge);
  return badge;
}

function updateBadge(badge, res) {
  badge.classList.remove("cs-badge--loading");

  if (!res || !res.matched) {
    badge.classList.add("cs-badge--nr");
    badge.innerHTML = '<span class="cs-badge__score">NR</span>';
    return;
  }

  const score = res.score;
  let colorClass;
  if (score >= 4.0) colorClass = "cs-badge--green";
  else if (score >= 3.0) colorClass = "cs-badge--yellow";
  else colorClass = "cs-badge--red";

  badge.classList.add(colorClass);

  if (res.vivinoUrl) {
    const link = document.createElement("a");
    link.href = res.vivinoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = badge.className;
    link.innerHTML = `
      <span class="cs-badge__score">${score?.toFixed(1) ?? "?"}</span>
      <span class="cs-badge__count">(${res.ratingsCount ?? 0})</span>
    `;
    badge.replaceWith(link);
  } else {
    badge.innerHTML = `
      <span class="cs-badge__score">${score?.toFixed(1) ?? "?"}</span>
      <span class="cs-badge__count">(${res.ratingsCount ?? 0})</span>
    `;
  }
}

// ── Card processing ─────────────────────────────────────────────────

async function processCard(card) {
  if (card.dataset.csProcessed) return;
  card.dataset.csProcessed = "true";

  const data = adapter.extractWineData(card);
  if (!data.name) return;

  // On non-wine pages, pre-filter to avoid useless API calls
  if (!onWinePage && !isLikelyWine(data.name)) return;

  const badge = injectLoadingBadge(card);

  try {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_VIVINO",
      wineName: data.name,
      wineType: detectedWineType,
    });

    updateBadge(badge, res);

    wineResults.push({
      name: data.name,
      price: data.price,
      productUrl: data.productUrl,
      score: res?.matched ? res.score : null,
      ratingsCount: res?.matched ? res.ratingsCount : null,
      vivinoUrl: res?.matched ? res.vivinoUrl : null,
    });

    chrome.storage.local.set({ cs_results: wineResults });
  } catch (err) {
    console.error("[CaveScore] Error processing card:", err);
    updateBadge(badge, null);
  }
}

function processVisibleCards() {
  if (!adapter.cardSelector) return;
  const cards = document.querySelectorAll(adapter.cardSelector);
  cards.forEach((card) => processCard(card));
}

function observeNewCards() {
  if (!adapter.cardSelector) return;
  const container =
    document.querySelector(adapter.productListSelector) || document.body;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(adapter.cardSelector)) {
          processCard(node);
        }
        node.querySelectorAll?.(adapter.cardSelector)?.forEach((card) =>
          processCard(card)
        );
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true });
}

function init() {
  adapter = findAdapter();
  if (!adapter) return;

  onWinePage = adapter.isWinePage();
  detectedWineType = onWinePage ? adapter.detectWineType() : null;

  console.log(
    `[CaveScore] ${adapter.name} — wine page: ${onWinePage}, type: ${detectedWineType ?? "unknown"}`
  );

  // Store site info for the popup
  chrome.storage.local.set({
    cs_site: {
      name: adapter.name,
      color: adapter.color,
      homeUrl: adapter.homeUrl,
    },
  });

  wineResults = [];
  chrome.storage.local.set({ cs_results: [] });

  processVisibleCards();
  observeNewCards();
}

init();
