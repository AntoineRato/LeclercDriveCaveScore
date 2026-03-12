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
  "cl", "ml", "bag", "box", "de", "du", "des", "la", "le", "les",
]);

// Cépages courants — peu distinctifs, présents dans beaucoup de vins
const GRAPE_VARIETIES = new Set([
  "viognier", "sauvignon", "merlot", "cabernet", "chardonnay", "pinot",
  "syrah", "shiraz", "grenache", "mourvedre", "cinsault", "carignan",
  "tempranillo", "malbec", "gamay", "muscat", "riesling", "gewurztraminer",
  "semillon", "chenin", "colombard", "ugni", "marsanne", "roussanne",
  "clairette", "picpoul", "vermentino", "rolle", "noir", "gris", "grigio",
  "meunier", "tannat", "cot", "petit", "verdot", "franc", "duras",
  "mauzac", "loin", "oeil", "manseng", "courbu", "arbane", "aligote",
]);

// Mots de région/appellation courants
const REGION_WORDS = new Set([
  "pays", "doc", "oc", "bordeaux", "bourgogne", "languedoc", "rhone",
  "loire", "alsace", "provence", "beaujolais", "cotes", "cote", "saint",
  "mont", "haut", "val", "village", "villages", "medoc", "graves",
  "pomerol", "margaux", "pessac", "leognan", "faugeres", "corbieres",
  "minervois", "fitou", "cahors", "gaillac", "madiran", "jurancon",
  "bandol", "ventoux", "luberon", "duche", "uzes", "costieres", "nimes",
  "entre", "deux", "mers", "pic", "loup", "terrasses", "larzac",
]);

function getTokenWeight(token) {
  if (GRAPE_VARIETIES.has(token)) return 0.4;
  if (REGION_WORDS.has(token)) return 0.4;
  if (/^\d{4}$/.test(token)) return 1.5; // millésime = très distinctif
  return 1.0; // mots distinctifs (producteur, nom de cuvée, lieu-dit…)
}

// ── Jaro-Winkler : similarité caractère par caractère (0..1) ──
function jaro(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1m = new Array(len1).fill(false);
  const s2m = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, len2);
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(s1, s2) {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

// ── Similarité entre deux tokens (0..1) ──
const JW_THRESHOLD = 0.85;

function tokenSimilarity(a, b) {
  if (a === b) return 1.0;
  // Tokens courts (< 4 chars) : exiger exact match pour éviter faux positifs ("oc" ~ "or")
  if (a.length < 4 || b.length < 4) return 0;
  // Préfixe commun (ex: "cab" → "cabernet" déjà filtré par guard ci-dessus)
  if (a.startsWith(b) || b.startsWith(a)) return 0.95;
  return jaroWinkler(a, b);
}

// ── Score principal : Weighted Soft Monge-Elkan avec pénalité ──
function computeMatchScore(query, candidate) {
  const allQTokens = normalizeWineName(query).split(" ").filter(Boolean);
  const allCTokens = normalizeWineName(candidate).split(" ").filter(Boolean);

  const qTokens = allQTokens.filter((t) => !STOP_WORDS.has(t) || /^\d{4}$/.test(t));
  const cTokens = allCTokens.filter((t) => !STOP_WORDS.has(t) || /^\d{4}$/.test(t));

  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Phase 1 — Query coverage (Monge-Elkan) :
  // Pour chaque token query, trouver le meilleur candidat (greedy, 1-à-1).
  // Les tokens distinctifs (poids élevé) ont la priorité.
  const cUsed = new Array(cTokens.length).fill(false);
  const qSorted = qTokens
    .map((t, i) => ({ token: t, weight: getTokenWeight(t), idx: i }))
    .sort((a, b) => b.weight - a.weight);

  let matchedWeight = 0;
  let totalQueryWeight = 0;

  for (const { token: qt, weight: qw } of qSorted) {
    totalQueryWeight += qw;
    let bestSim = 0;
    let bestIdx = -1;

    for (let j = 0; j < cTokens.length; j++) {
      if (cUsed[j]) continue;
      const sim = tokenSimilarity(qt, cTokens[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestSim >= JW_THRESHOLD) {
      matchedWeight += qw * bestSim;
      if (bestIdx >= 0) cUsed[bestIdx] = true;
    }
  }

  const queryCoverage = totalQueryWeight > 0 ? matchedWeight / totalQueryWeight : 0;

  // Phase 2 — Pénalité pour mots distinctifs du candidat non matchés
  // (ex: "Frou Frou" dans le candidat mais pas dans la query)
  let unmatchedCandWeight = 0;
  let totalCandWeight = 0;

  for (let j = 0; j < cTokens.length; j++) {
    const w = getTokenWeight(cTokens[j]);
    totalCandWeight += w;
    if (!cUsed[j]) {
      const hasMatch = qTokens.some((qt) => tokenSimilarity(qt, cTokens[j]) >= JW_THRESHOLD);
      if (!hasMatch) unmatchedCandWeight += w;
    }
  }

  const penaltyRatio = totalCandWeight > 0 ? unmatchedCandWeight / totalCandWeight : 0;

  // Phase 3 — Score final
  const PENALTY_STRENGTH = 0.6;
  return queryCoverage * (1 - PENALTY_STRENGTH * penaltyRatio);
}

function cleanWineName(name) {
  return name
    .replace(/\s*[-–]?\s*\d+\s*x\s*\d+[,.]?\d*\s*(cl|l)\b/gi, "")
    .replace(/\s*[-–]?\s*\d+[,.]?\d*\s*(cl|l)\b/gi, "")
    .replace(/\bvin\b/gi, "")
    .replace(/\s*[-–]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Vivino utilise Algolia pour la recherche — mêmes clés publiques que leur site web
const ALGOLIA_URL =
  "https://9takgwjuxl-dsn.algolia.net/1/indexes/WINES_prod/query" +
  "?x-algolia-agent=Algolia+for+JavaScript+(3.33.0);+Browser+(lite)" +
  "&x-algolia-application-id=9TAKGWJUXL" +
  "&x-algolia-api-key=60c11b2f1068885161d95ca068d3a6ae";

async function fetchVivino(wineName, wineType = null) {
  const cacheKey = `${normalizeWineName(wineName)}|${wineType ?? ""}`;
  if (vivinoCache.has(cacheKey)) return vivinoCache.get(cacheKey);

  const query = cleanWineName(wineName);

  // Construire les params Algolia avec filtre optionnel sur le type de vin
  let algoliaParams = `query=${encodeURIComponent(query)}&hitsPerPage=10`;
  if (wineType) {
    algoliaParams += `&filters=wine_type_id=${wineType}`;
  }

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
      body: JSON.stringify({ params: algoliaParams }),
    });

    if (!resp.ok) {
      console.warn(`[CaveScore] Algolia HTTP ${resp.status} pour "${wineName}"`);
      vivinoCache.set(cacheKey, null);
      return null;
    }

    const data = await resp.json();
    const hits = data?.hits;

    if (!hits || hits.length === 0) {
      console.warn(`[CaveScore] Aucun résultat Algolia pour "${query}"${wineType ? ` (type=${wineType})` : ""}`);
      vivinoCache.set(cacheKey, null);
      return null;
    }

    // Debug : afficher la structure du premier hit pour voir les champs disponibles
    console.log(`[CaveScore] Structure hit Algolia pour "${query}":`,
      JSON.stringify(Object.keys(hits[0])),
      "winery:", JSON.stringify(hits[0].winery));

    // Parcourir tous les hits et garder le meilleur match
    let bestMatch = null;
    let bestScore = 0;

    for (const hit of hits) {
      const wineName = hit.name || "";
      if (!wineName) continue;

      // Combiner producteur + nom du vin pour le matching
      // Sur Vivino, le nom du vin est souvent juste le cépage/cuvée,
      // le producteur est dans un champ séparé (winery)
      const wineryName = hit.winery?.name || "";
      const fullCandidate = wineryName ? `${wineryName} ${wineName}` : wineName;

      const matchScore = computeMatchScore(query, fullCandidate);
      if (matchScore > bestScore) {
        bestScore = matchScore;
        bestMatch = {
          matched: true,
          score: hit.statistics?.ratings_average ?? null,
          ratingsCount: hit.statistics?.ratings_count ?? 0,
          vivinoUrl: hit.seo_name && hit.id
            ? `https://www.vivino.com/${hit.seo_name}/w/${hit.id}`
            : null,
          wineName: fullCandidate,
        };
      }
    }

    if (bestMatch && bestScore >= 0.4) {
      console.log(`[CaveScore] "${query}" → "${bestMatch.wineName}" (match=${bestScore.toFixed(2)}, rating=${bestMatch.score})`);
      vivinoCache.set(cacheKey, bestMatch);
      return bestMatch;
    }

    console.warn(`[CaveScore] Aucun match acceptable pour "${query}" (best=${bestScore.toFixed(2)}) — premiers hits:`,
      hits.slice(0, 3).map(h => {
        const full = h.winery?.name ? `${h.winery.name} ${h.name}` : h.name;
        return `${full} (${computeMatchScore(query, full).toFixed(2)})`;
      }));
    const result = { matched: false };
    vivinoCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("[CaveScore] Vivino fetch error:", err);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_VIVINO") {
    fetchVivino(msg.wineName, msg.wineType).then(sendResponse);
    return true; // maintient le canal ouvert pour réponse async
  }
});
