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

// Mots génériques ignorés dans le calcul de similarité
const STOP_WORDS = new Set([
  "rouge", "blanc", "rose", "vin", "vins", "chateau",
  "aop", "aoc", "igp", "vdf", "bio", "bib",
  "selection", "cuvee", "reserve", "grande", "grand",
  "cl", "ml", "bag", "box",
]);

function computeMatchScore(query, candidate) {
  const allQTokens = normalizeWineName(query).split(" ").filter(Boolean);
  const cTokens = normalizeWineName(candidate).split(" ").filter(Boolean);

  // Filtrer les stop words pour le calcul, mais garder les millésimes
  const qTokens = allQTokens.filter((t) => !STOP_WORDS.has(t) || /^\d{4}$/.test(t));

  if (qTokens.length === 0) return 0;

  let matched = 0;
  let vintageBonus = 0;

  for (const qt of qTokens) {
    if (cTokens.some((ct) => ct === qt || ct.startsWith(qt) || qt.startsWith(ct))) {
      matched++;
      if (/^\d{4}$/.test(qt)) vintageBonus = 0.1;
    }
  }

  const overlap = matched / qTokens.length;
  return Math.min(overlap + vintageBonus, 1);
}

function cleanWineName(name) {
  return name
    .replace(/^(AOP|AOC|IGP|VDF|Vin de France)\s+/i, "")
    .replace(/\s*[-–]\s*\d+[,.]?\d*\s*(cl|l)\b.*$/i, "")
    .replace(/\bvin\b/gi, "")
    .replace(/\b\d+\s*x\s*\d+\s*(cl|l)\b/gi, "")
    .replace(/\b\d+[,.]?\d*\s*(cl|l)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Vivino utilise Algolia pour la recherche — mêmes clés publiques que leur site web
const ALGOLIA_URL =
  "https://9takgwjuxl-dsn.algolia.net/1/indexes/WINES_prod/query" +
  "?x-algolia-agent=Algolia+for+JavaScript+(3.33.0);+Browser+(lite)" +
  "&x-algolia-application-id=9TAKGWJUXL" +
  "&x-algolia-api-key=60c11b2f1068885161d95ca068d3a6ae";

async function fetchVivino(wineName) {
  const key = normalizeWineName(wineName);
  if (vivinoCache.has(key)) return vivinoCache.get(key);

  const query = cleanWineName(wineName);

  try {
    const resp = await fetch(ALGOLIA_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
      },
      referrer: "https://www.vivino.com/",
      referrerPolicy: "origin-when-cross-origin",
      mode: "cors",
      credentials: "omit",
      body: JSON.stringify({
        params: `query=${encodeURIComponent(query)}&hitsPerPage=5`,
      }),
    });

    if (!resp.ok) {
      console.warn(`[CaveScore] Algolia HTTP ${resp.status} pour "${wineName}"`);
      vivinoCache.set(key, null);
      return null;
    }

    const data = await resp.json();
    const hits = data?.hits;

    if (!hits || hits.length === 0) {
      console.warn(`[CaveScore] Aucun résultat Algolia pour "${query}"`);
      vivinoCache.set(key, null);
      return null;
    }

    // Algolia trie déjà par pertinence — on prend le premier hit
    // dont le match score dépasse le seuil minimum
    let bestMatch = null;

    for (const hit of hits) {
      const candidateName = hit.name || "";
      if (!candidateName) continue;

      const matchScore = computeMatchScore(query, candidateName);
      if (matchScore < 0.3) continue;

      bestMatch = {
        matched: true,
        score: hit.statistics?.ratings_average ?? null,
        ratingsCount: hit.statistics?.ratings_count ?? 0,
        vivinoUrl: hit.seo_name && hit.id
          ? `https://www.vivino.com/${hit.seo_name}/w/${hit.id}`
          : null,
        wineName: candidateName,
      };
      console.log(`[CaveScore] "${query}" → "${candidateName}" (match=${matchScore.toFixed(2)}, rating=${bestMatch.score})`);
      break; // premier résultat Algolia acceptable
    }

    if (bestMatch) {
      vivinoCache.set(key, bestMatch);
      return bestMatch;
    }

    console.warn(`[CaveScore] Aucun match acceptable pour "${query}" — premiers hits:`,
      hits.slice(0, 3).map(h => h.name));
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
