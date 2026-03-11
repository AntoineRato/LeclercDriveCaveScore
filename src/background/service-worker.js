// CaveScore — Service Worker (MV3)
// Proxy API Vivino (CORS), cache en mémoire, routeur de messages.

const vivinoCache = new Map();

function normalizeWineName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeMatchScore(query, candidate) {
  const qTokens = normalizeWineName(query).split(" ").filter(Boolean);
  const cTokens = normalizeWineName(candidate).split(" ").filter(Boolean);

  if (qTokens.length === 0) return 0;

  let matched = 0;
  let vintageBonus = 0;

  for (const qt of qTokens) {
    if (cTokens.some((ct) => ct === qt)) {
      matched++;
      if (/^\d{4}$/.test(qt)) vintageBonus = 0.1;
    }
  }

  const overlap = matched / qTokens.length;
  return Math.min(overlap + vintageBonus, 1);
}

async function fetchVivino(wineName) {
  const key = normalizeWineName(wineName);
  if (vivinoCache.has(key)) return vivinoCache.get(key);

  try {
    const url = `https://www.vivino.com/api/explore/explore?q=${encodeURIComponent(wineName)}&language=fr`;
    const resp = await fetch(url);
    if (!resp.ok) {
      vivinoCache.set(key, null);
      return null;
    }

    const data = await resp.json();
    const matches = data?.explore_vintage?.matches;

    if (!matches || matches.length === 0) {
      vivinoCache.set(key, null);
      return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const m of matches) {
      const vintage = m.vintage;
      const wine = vintage?.wine;
      if (!wine) continue;

      const candidateName = [wine.name, vintage.year].filter(Boolean).join(" ");
      const score = computeMatchScore(wineName, candidateName);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          matched: true,
          score: vintage.statistics?.ratings_average ?? wine.statistics?.ratings_average ?? null,
          ratingsCount: vintage.statistics?.ratings_count ?? wine.statistics?.ratings_count ?? 0,
          vivinoUrl: `https://www.vivino.com${wine.seo_name ? `/w/${wine.id}` : ""}`,
          wineName: candidateName,
        };
      }
    }

    if (bestMatch && bestScore >= 0.6) {
      vivinoCache.set(key, bestMatch);
      return bestMatch;
    }

    const result = { matched: false };
    vivinoCache.set(key, result);
    return result;
  } catch (err) {
    console.error("[CaveScore] Vivino fetch error:", err);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_VIVINO") {
    fetchVivino(msg.wineName).then(sendResponse);
    return true; // maintient le canal ouvert pour réponse async
  }
});
