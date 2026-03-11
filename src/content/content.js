// CaveScore — Content Script
// Injecte les badges Vivino sur les cartes vins de leclercdrive.fr

const WINE_RAYON_IDS = ["289555", "284518"];
const PRODUCT_LIST_SELECTOR = "div#divWCRS310_ProductsList";
const CARD_SELECTOR = "li.liWCRS310_Product[data-vignette='disponible']";

let wineResults = [];

function isWinePage() {
  return WINE_RAYON_IDS.some((id) =>
    window.location.pathname.includes(`rayon-${id}`)
  );
}

function extractWineData(card) {
  const nameEl = card.querySelector(".pWCRS310_Desc .aWCRS310_Product");
  const name = nameEl?.textContent.replace(/\s+/g, " ").trim() || null;

  const intPart = card
    .querySelector(".pWCRS310_PrixUnitairePartieEntiere")
    ?.textContent.trim();
  const decPart = card
    .querySelector(".pWCRS310_PrixUnitairePartieDecimale")
    ?.textContent.trim();
  const price = intPart ? `${intPart},${decPart ?? "00"}\u20AC` : null;

  const linkEl = card.querySelector("a.aWCRS310_Product");
  const productUrl = linkEl?.href || window.location.href;

  return { name, price, productUrl, cardElement: card };
}

function injectLoadingBadge(card) {
  // Ensure parent has relative positioning for absolute badge
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
  else if (score >= 3.5) colorClass = "cs-badge--yellow";
  else colorClass = "cs-badge--red";

  badge.classList.add(colorClass);

  // Wrap badge in a link to Vivino if URL available
  if (res.vivinoUrl) {
    const link = document.createElement("a");
    link.href = res.vivinoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = badge.className;
    link.innerHTML = `
      <span class="cs-badge__score">${score?.toFixed(1) ?? "?"}</span>
      <span class="cs-badge__count">${res.ratingsCount ?? 0}</span>
    `;
    badge.replaceWith(link);
  } else {
    badge.innerHTML = `
      <span class="cs-badge__score">${score?.toFixed(1) ?? "?"}</span>
      <span class="cs-badge__count">${res.ratingsCount ?? 0}</span>
    `;
  }
}

async function processCard(card) {
  if (card.dataset.csProcessed) return;
  card.dataset.csProcessed = "true";

  const data = extractWineData(card);
  if (!data.name) return;

  const badge = injectLoadingBadge(card);

  try {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_VIVINO",
      wineName: data.name,
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
  const cards = document.querySelectorAll(CARD_SELECTOR);
  cards.forEach((card) => processCard(card));
}

function observeNewCards() {
  const container = document.querySelector(PRODUCT_LIST_SELECTOR) || document.body;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(CARD_SELECTOR)) {
          processCard(node);
        }
        // Also check children (in case a wrapper was added)
        node.querySelectorAll?.(CARD_SELECTOR)?.forEach((card) => processCard(card));
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true });
}

function init() {
  if (!isWinePage()) return;

  // Reset results for this page load
  wineResults = [];
  chrome.storage.local.set({ cs_results: [] });

  processVisibleCards();
  observeNewCards();
}

init();
