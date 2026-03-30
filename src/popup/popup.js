// CaveScore — Popup script

function loadResults() {
  return new Promise((resolve) => {
    chrome.storage.local.get("cs_results", (data) => {
      resolve(data.cs_results || []);
    });
  });
}

function loadSiteInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get("cs_site", (data) => {
      resolve(data.cs_site || null);
    });
  });
}

function sortResults(results) {
  return results.slice().sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });
}

function scoreColorClass(score) {
  if (score === null) return "wine-entry__score--nr";
  if (score >= 4.0) return "wine-entry__score--green";
  if (score >= 3.0) return "wine-entry__score--yellow";
  return "wine-entry__score--red";
}

function renderList(results, filterMatchOnly) {
  const list = document.getElementById("ranking");
  const counter = document.getElementById("counter");
  list.innerHTML = "";

  const filtered = filterMatchOnly
    ? results.filter((r) => r.score !== null)
    : results;

  counter.textContent = `${filtered.length} vin${filtered.length !== 1 ? "s" : ""}`;

  filtered.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "wine-entry";

    const scoreText = r.score !== null ? r.score.toFixed(1) : "NR";
    const colorClass = scoreColorClass(r.score);

    li.innerHTML = `
      <span class="wine-entry__rank">${i + 1}</span>
      <span class="wine-entry__name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
      <span class="wine-entry__price">${escapeHtml(r.price || "")}</span>
      <span class="wine-entry__score ${colorClass}">${scoreText}</span>
      <span class="wine-entry__links">
        ${r.vivinoUrl ? `<a href="${escapeHtml(r.vivinoUrl)}" target="_blank" title="Voir sur Vivino">V</a>` : ""}
        <a href="${escapeHtml(r.productUrl)}" target="_blank" title="Voir sur le site">D</a>
      </span>
    `;

    list.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  // Load site info and apply branding
  const site = await loadSiteInfo();
  if (site) {
    document.documentElement.style.setProperty("--cs-accent", site.color);
    const siteLink = document.getElementById("siteLink");
    siteLink.href = site.homeUrl;
    siteLink.textContent = `Ouvrir ${site.name}`;
  }

  const raw = await loadResults();
  const sorted = sortResults(raw);
  const toggle = document.getElementById("filterToggle");

  renderList(sorted, toggle.checked);

  toggle.addEventListener("change", () => {
    renderList(sorted, toggle.checked);
  });
}

document.addEventListener("DOMContentLoaded", init);
