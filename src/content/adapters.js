// CaveScore — Site Adapters
// Each adapter defines how to extract wine data from a specific retailer's website.
//
// To add a new site:
//   1. Inspect the site's wine listing HTML to identify selectors
//   2. Add an entry below with all required methods
//   3. Add the domain to manifest.json (host_permissions + content_scripts.matches)

const CS_ADAPTERS = {

  // ─── Leclerc Drive ────────────────────────────────────────────────
  "leclercdrive.fr": {
    name: "Leclerc Drive",
    color: "#E2001A",
    homeUrl: "https://www.leclercdrive.fr",
    productListSelector: "div#divWCRS310_ProductsList",
    cardSelector: "li.liWCRS310_Product[data-vignette='disponible']",

    isWinePage() {
      const WINE_RAYON_IDS = ["289555", "284518"];
      return WINE_RAYON_IDS.some((id) =>
        window.location.pathname.includes(`rayon-${id}`)
      );
    },

    detectWineType() {
      const url = window.location.href;
      if (url.includes("rayon-284518")) return 7;
      const filterMatch = url.match(/Filtres=4-(\d+)/);
      if (filterMatch) {
        const map = { "289556": 1, "289557": 2, "289558": 3 };
        return map[filterMatch[1]] || null;
      }
      return null;
    },

    extractWineData(card) {
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

      return { name, price, productUrl };
    },
  },

  // ─── Intermarché ──────────────────────────────────────────────────
  "intermarche.com": {
    name: "Intermarché",
    color: "#ED1C24",
    homeUrl: "https://www.intermarche.com",
    productListSelector: null, // TODO: inspect site HTML
    cardSelector: null,        // TODO: inspect site HTML

    isWinePage() {
      // TODO: identify URL pattern for wine pages
      return false;
    },

    detectWineType() {
      // TODO: identify wine type filters in URL or DOM
      return null;
    },

    extractWineData(card) {
      // TODO: implement selectors for name, price, product URL
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Courses U (Système U) ────────────────────────────────────────
  "coursesu.com": {
    name: "Courses U",
    color: "#E60012",
    homeUrl: "https://www.coursesu.com",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Casino Drive ─────────────────────────────────────────────────
  "casinodrive.fr": {
    name: "Casino Drive",
    color: "#D41E25",
    homeUrl: "https://www.casinodrive.fr",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Chronodrive ──────────────────────────────────────────────────
  "chronodrive.com": {
    name: "Chronodrive",
    color: "#00A651",
    homeUrl: "https://www.chronodrive.com",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Monoprix ─────────────────────────────────────────────────────
  "monoprix.fr": {
    name: "Monoprix",
    color: "#DA291C",
    homeUrl: "https://courses.monoprix.fr",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Franprix ─────────────────────────────────────────────────────
  "franprix.fr": {
    name: "Franprix",
    color: "#FF0000",
    homeUrl: "https://www.franprix.fr",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },

  // ─── Nicolas ──────────────────────────────────────────────────────
  "nicolas.com": {
    name: "Nicolas",
    color: "#8B0000",
    homeUrl: "https://www.nicolas.com",
    productListSelector: null, // TODO
    cardSelector: null,        // TODO

    isWinePage() { return false; },          // TODO
    detectWineType() { return null; },       // TODO
    extractWineData(card) {                  // TODO
      return { name: null, price: null, productUrl: window.location.href };
    },
  },
};
