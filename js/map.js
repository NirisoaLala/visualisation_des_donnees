/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// Les formats de date : "format" transforme une date en texte.
// (Le CSV n'a pas de colonne "date" : on la reconstruit à partir de
// year, month, day, hour au moment du chargement.)
const fmtMonth  = d3.timeFormat("%Y-%m");      // ex. "2012-03"
const fmtDay    = d3.timeFormat("%Y-%m-%d");   // ex. "2012-03-15"

// Les variables qu'on peut afficher. La clé (pollution, temp...) doit être
// le nom exact de la colonne dans le CSV. "interpolator" = la palette de couleurs.
const VARIABLES = {
  pollution: { label: "PM2.5",           unit: "µg/m³", interpolator: d3.interpolateYlOrRd },
  temp:      { label: "Température",     unit: "°C",    interpolator: t => d3.interpolateRdYlBu(1 - t) },
  dew:       { label: "Point de rosée",  unit: "°C",    interpolator: d3.interpolateBlues },
  press:     { label: "Pression",        unit: "hPa",   interpolator: d3.interpolatePurples },
  wnd_spd:   { label: "Vitesse du vent", unit: "m/s",   interpolator: d3.interpolateGreens }
};

// Les dimensions : taille d'une case et marges autour du dessin
const CELL = { w: 20, h: 13 };
const MARGIN = { top: 30, right: 10, bottom: 10, left: 60 };

// L'état de l'application : ce que l'utilisateur a choisi
const state = {
  variable: "pollution",  // variable colorée
  selected: null          // jour cliqué, ex. "2012-03-15" (null = aucun)
};

// Ces variables seront remplies quand le CSV sera chargé
let data = [];        // toutes les lignes du CSV (1 ligne = 1 heure)
let months = [];      // la liste des mois : ["2010-01", "2010-02", ...]
let byDay = new Map(); // jour -> les 24 lignes horaires de ce jour
let cellsSel;         // la sélection D3 de toutes les cases (pour les surligner)

const tooltip = d3.select("#tooltip");

/* ============================================================
   2. CHARGEMENT DES DONNÉES
   ============================================================ */

// d3.csv lit le fichier ligne par ligne. La fonction (d => ...) transforme
// chaque ligne : le "+" convertit le texte en nombre.
// Colonnes du CSV : No, year, month, day, hour, pm2.5, DEWP, TEMP, PRES, cbwd, Iws, Is, Ir
// Les valeurs "NA" (mesure absente) deviennent NaN avec le "+", et sont ignorées par d3.mean.
d3.csv("data/pollution.csv", d => ({
  date: new Date(+d.year, +d.month - 1, +d.day, +d.hour),  // les mois JS vont de 0 à 11
  pollution: +d["pm2.5"],
  temp: +d.TEMP,
  dew: +d.DEWP,
  press: +d.PRES,
  wnd_spd: +d.Iws
}))
.then(rows => {
  data = rows;
  months = [...new Set(data.map(d => fmtMonth(d.date)))].sort();
  byDay = d3.group(data, d => fmtDay(d.date)); // regroupe les lignes par jour

  initSelect();
  drawHeatmap();
  drawDetail();
})
.catch(err => {
  // Erreur typique : le fichier est ouvert en file:// au lieu d'un serveur local
  d3.select("#heatmap").append("p").attr("class", "error")
    .text("Impossible de charger pollution.csv. Lance un serveur local " +
          "(python -m http.server) et ouvre http://localhost:8000. Détail : " + err);
});

/* ============================================================
   3. MENU DÉROULANT (choix de la variable)
   ============================================================ */

function initSelect() {
  d3.select("#variable")
    .selectAll("option")
    .data(Object.entries(VARIABLES))       // [["pollution", {...}], ["temp", {...}], ...]
    .join("option")                         // une <option> par variable
      .attr("value", d => d[0])
      .text(d => d[1].label)
    .property("selected", d => d[0] === state.variable);

  // Quand l'utilisateur change de variable : on met à jour l'état, puis on redessine
  d3.select("#variable").on("change", function () {
    state.variable = this.value;
    drawHeatmap();
    drawDetail();
  });
}

/* ============================================================
   4. VUE D'ENSEMBLE : LA HEATMAP
   ============================================================ */

function drawHeatmap() {
  const v = VARIABLES[state.variable];

  // --- 4a. Agrégation : moyenne de la variable pour chaque (mois, jour) ---
  // d3.rollups regroupe par mois, puis par jour, et calcule la moyenne.
  // d3.mean ignore les valeurs manquantes (NaN).
  const cells = [];
  const grouped = d3.rollups(
    data,
    g => d3.mean(g, d => d[state.variable]),
    d => fmtMonth(d.date),
    d => d.date.getDate()
  );
  for (const [month, days] of grouped) {
    for (const [day, value] of days) {
      cells.push({
        month, day, value,
        key: `${month}-${String(day).padStart(2, "0")}`  // ex. "2012-03-05"
      });
    }
  }

  // --- 4b. Échelles : elles traduisent une donnée en position ou en couleur ---
  const width  = 31 * CELL.w;
  const height = months.length * CELL.h;

  // scaleBand : une "bande" par valeur catégorielle (jour 1..31, mois)
  const x = d3.scaleBand().domain(d3.range(1, 32)).range([0, width]).padding(0.05);
  const y = d3.scaleBand().domain(months).range([0, height]).padding(0.05);

  // scaleSequential : une valeur numérique -> une couleur de la palette
  const extent = d3.extent(cells, d => d.value);   // [min, max]
  const color = d3.scaleSequential(v.interpolator).domain(extent);

  // --- 4c. Dessin : on efface l'ancien SVG puis on en recrée un ---
  d3.select("#heatmap").selectAll("*").remove();

  const svg = d3.select("#heatmap").append("svg")
      .attr("width",  MARGIN.left + width  + MARGIN.right)
      .attr("height", MARGIN.top  + height + MARGIN.bottom)
    .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

  // Les axes. On n'affiche pas tous les mois (60 étiquettes serait illisible) :
  // seulement janvier et juillet de chaque année.
  svg.append("g")
      .call(d3.axisTop(x).tickValues([1, 5, 10, 15, 20, 25, 30]).tickSize(0))
      .call(g => g.select(".domain").remove());

  svg.append("g")
      .call(d3.axisLeft(y)
        .tickValues(months.filter(m => m.endsWith("-01") || m.endsWith("-07")))
        .tickSize(0))
      .call(g => g.select(".domain").remove());

  // --- 4d. Les cases : le "data join" ---
  // selectAll("rect").data(cells).join("rect") = "crée un rectangle par élément de cells"
  cellsSel = svg.selectAll("rect.cell")
    .data(cells)
    .join("rect")
      .attr("class", "cell")
      .attr("x", d => x(d.day))
      .attr("y", d => y(d.month))
      .attr("width",  x.bandwidth())
      .attr("height", y.bandwidth())
      // Valeur manquante -> gris, sinon la couleur de l'échelle
      .attr("fill", d => Number.isFinite(d.value) ? color(d.value) : "#ddd")

      // --- Interactions ---
      .on("mouseover", () => tooltip.style("opacity", 1))
      .on("mousemove", (event, d) => {
        tooltip
          .html(`<b>${d.key}</b><br>${v.label} : ${Number.isFinite(d.value) ? d.value.toFixed(1) : "n/a"} ${v.unit}`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY + 12) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0))
      .on("click", (event, d) => {
        state.selected = d.key;   // on mémorise le jour cliqué
        highlightSelected();      // on le surligne dans la heatmap
        drawDetail();             // on dessine la vue de détails
      });

  highlightSelected();
  drawLegend(color, extent, v);
}

// Entoure d'un trait noir la case du jour sélectionné
function highlightSelected() {
  cellsSel
    .attr("stroke", d => d.key === state.selected ? "#000" : "none")
    .attr("stroke-width", 1.5);
  cellsSel.filter(d => d.key === state.selected).raise(); // la met au premier plan
}

/* ============================================================
   5. LÉGENDE : un dégradé + un axe
   ============================================================ */

function drawLegend(color, extent, v) {
  const W = 260, H = 14;
  d3.select("#legend").selectAll("*").remove();

  const svg = d3.select("#legend").append("svg")
      .attr("width", W + 40).attr("height", 54);

  // Un dégradé SVG : on échantillonne la palette de 0 à 1 par pas de 0.1
  const grad = svg.append("defs").append("linearGradient").attr("id", "legend-gradient");
  d3.range(0, 1.01, 0.1).forEach(t =>
    grad.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", v.interpolator(t)));

  const g = svg.append("g").attr("transform", "translate(20,18)");
  g.append("rect").attr("width", W).attr("height", H).attr("fill", "url(#legend-gradient)");

  // Un axe sous le dégradé, avec les valeurs min -> max
  const scale = d3.scaleLinear().domain(extent).range([0, W]);
  g.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(scale).ticks(5).tickSize(4))
    .call(a => a.select(".domain").remove());

  svg.append("text").attr("x", 20).attr("y", 12)
    .text(`${v.label} moyen (${v.unit})`);
}

/* ============================================================
   6. VUE DE DÉTAILS : COURBE HORAIRE DU JOUR CLIQUÉ
   ============================================================ */

function drawDetail() {
  const box = d3.select("#detail");
  box.selectAll("*").remove();

  // Rien de sélectionné : on affiche une consigne
  if (!state.selected) {
    box.append("p").attr("class", "hint")
      .text("Clique sur une case de la heatmap pour voir l'évolution heure par heure de ce jour.");
    return;
  }

  const v = VARIABLES[state.variable];
  // les ~24 mesures de ce jour, sans les heures où la mesure est absente (NaN)
  const rows = (byDay.get(state.selected) || []).filter(d => Number.isFinite(d[state.variable]));
  if (rows.length === 0) {
    box.append("p").attr("class", "hint")
      .text(`Aucune mesure de ${v.label} le ${state.selected}.`);
    return;
  }

  const W = 440, H = 260;
  const m = { top: 40, right: 20, bottom: 40, left: 55 };
  const w = W - m.left - m.right;
  const h = H - m.top - m.bottom;

  // Échelles : x = heure (0..23), y = valeur de la variable
  const x = d3.scaleLinear().domain([0, 23]).range([0, w]);
  const yMin = Math.min(0, d3.min(rows, d => d[state.variable]));  // on part de 0 si possible
  const y = d3.scaleLinear()
      .domain([yMin, d3.max(rows, d => d[state.variable])])
      .nice()          // arrondit les bornes pour des graduations propres
      .range([h, 0]);  // attention : en SVG, y=0 est en HAUT, donc on inverse

  const svg = box.append("svg").attr("width", W).attr("height", H)
    .append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Titre
  svg.append("text").attr("x", 0).attr("y", -18).style("font-size", "13px").style("font-weight", "600")
    .text(`${v.label} le ${state.selected}`);

  // Axes
  svg.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(8));
  svg.append("g").call(d3.axisLeft(y).ticks(5));

  svg.append("text").attr("x", w / 2).attr("y", h + 34).attr("text-anchor", "middle").text("Heure");
  svg.append("text").attr("transform", "rotate(-90)").attr("x", -h / 2).attr("y", -42)
    .attr("text-anchor", "middle").text(`${v.label} (${v.unit})`);

  // La courbe : d3.line() transforme une liste de points en tracé
  const line = d3.line()
    .x(d => x(d.date.getHours()))
    .y(d => y(d[state.variable]));

  svg.append("path")
    .datum(rows)                 // .datum = UNE donnée (le tableau entier) pour UN tracé
    .attr("fill", "none")
    .attr("stroke", "#c0392b")
    .attr("stroke-width", 2)
    .attr("d", line);

  // Un point par heure, avec tooltip
  svg.selectAll("circle")
    .data(rows)
    .join("circle")
      .attr("cx", d => x(d.date.getHours()))
      .attr("cy", d => y(d[state.variable]))
      .attr("r", 3.5)
      .attr("fill", "#c0392b")
      .on("mouseover", () => tooltip.style("opacity", 1))
      .on("mousemove", (event, d) => {
        tooltip
          .html(`${d.date.getHours()}h : ${d[state.variable].toFixed(1)} ${v.unit}`)
          .style("left", (event.pageX + 12) + "px")
          .style("top",  (event.pageY + 12) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0));
}