/************************************************************
 PART B — SEASONAL URBAN HEAT ISLAND FROM MODIS
 Mumbai  ·  Person U
 ============================================================
 Self-contained. Paste the whole file into the GEE Code Editor
 and run. No other script required.

 Contents
   A.  Parameters
   B.  AOI, zones and masks   (+ visualisation)
   C.  Setup diagnostics      — run once, record the numbers
   D.  MODIS helpers
   E.  Headline seasonal UHI  (Terra + Aqua, day + night)
   F.  Sensitivity 1 — interannual spread
   G.  Sensitivity 2 — rural ring geometry
   H.  Sensitivity 3 — water inclusion (justifies the exclusion)
   I.  Maps
   J.  Charts
   K.  Exports
 ************************************************************/


/* ============================================================
   A)  PARAMETERS
   ============================================================ */

// Uploaded GADM v4.1 level-2 boundary: Mumbai City district.
var AOI_ASSET = 'projects/ee-ujjwalguptaug0611/assets/Mumbai_AOI_FINAL';

// Multi-year window for the headline composites.
var YEAR_START = 2019;
var YEAR_END   = 2023;          // inclusive

/* Year of M's Landsat pair (8-9 October 2015). Section L repeats
   the seasonal calculation for this single year so that the
   cross-sensor comparison is like-for-like in time. Without it
   the comparison would confound season with an eight-year gap. */
var LANDSAT_YEAR = 2015;

/* Rural reference ring, in metres beyond the administrative
   boundary. The 5 km inner gap keeps the peri-urban fringe and
   the urban plume out of the reference. */
var RURAL_INNER_M = 5000;
var RURAL_OUTER_M = 20000;

/* Seasons — India Meteorological Department convention, all four.
   None wraps the calendar year, so each year contributes exactly
   one instance of each season.

   Post-monsoon is included because M's Landsat pair falls on
   8-9 October 2015, which sits in this season. Omitting it would
   leave the Part A / Part B comparison without a matching season. */
var SEASONS = [
  {name: 'Winter',       startMonth: 1,  endMonth: 2},
  {name: 'Pre-monsoon',  startMonth: 3,  endMonth: 5},
  {name: 'Monsoon',      startMonth: 6,  endMonth: 9},
  {name: 'Post-monsoon', startMonth: 10, endMonth: 12}
];

// The season M's Landsat scene falls in — drives section L.
var COMPARISON_SEASON = SEASONS[3];   // Post-monsoon

var PLATFORMS = [
  {name: 'Terra', id: 'MODIS/061/MOD11A2', dayLocal: '10:30', nightLocal: '22:30'},
  {name: 'Aqua',  id: 'MODIS/061/MYD11A2', dayLocal: '13:30', nightLocal: '01:30'}
];

var MODES = [
  {name: 'Day',   lstBand: 'LST_Day_1km',   qcBand: 'QC_Day',   viewBand: 'Day_view_time'},
  {name: 'Night', lstBand: 'LST_Night_1km', qcBand: 'QC_Night', viewBand: 'Night_view_time'}
];

// MOD11A2 / MYD11A2 scale factors (EE catalogue, LP DAAC user guide).
var LST_SCALE       = 0.02;     // -> kelvin
var VIEW_TIME_SCALE = 0.1;      // -> local solar hours

var STATS_SCALE_M = 1000;       // native MODIS grid; no resampling
var MAX_PIXELS    = 1e10;

// Platform/mode used for the sensitivity tests and seasonal maps.
// Terra Day is chosen because its ~10:30 overpass is closest to
// Landsat 8, making Part B directly comparable to Part A.
var SENS_PLATFORM = PLATFORMS[0];
var SENS_MODE     = MODES[0];

var VIS_LST = {min: 22, max: 42,
  palette: ['040274', '2166ac', '67a9cf', 'd1e5f0', 'fddbc7', 'ef8a62', 'b2182b']};
var VIS_ANOM = {min: -3, max: 6,
  palette: ['1a9850', '91cf60', 'fee08b', 'f46d43', 'a50026']};
var VIS_OBS = {min: 0, max: 60,
  palette: ['000000', '440154', '21918c', '5ec962', 'fde725']};


/* ============================================================
   B)  AOI, ZONES AND MASKS
   ============================================================ */

var aoiFC = ee.FeatureCollection(AOI_ASSET);
var aoi   = aoiFC.geometry();

// Ellipsoidal area; the source file is EPSG:4326 (geographic), so
// area cannot be measured in the source CRS units directly.
var AOI_AREA_KM2 = aoi.area({maxError: 1}).divide(1e6);

// Rural ring and the full extent the analysis ever touches.
var ruralZone      = aoi.buffer(RURAL_OUTER_M).difference(aoi.buffer(RURAL_INNER_M), 1);
var analysisExtent = aoi.buffer(RURAL_OUTER_M);

/* ESA WorldCover v200 (2021). Clipped to the BUFFERED extent —
   clipping to the city would leave the rural mask empty. */
var worldcover = ee.ImageCollection('ESA/WorldCover/v200')
  .first().select('Map').clip(analysisExtent);

var isBuilt    = worldcover.eq(50);
var isWater    = worldcover.eq(80);
var isWetland  = worldcover.eq(90).or(worldcover.eq(95));  // wetland + mangrove

/* Rural land cover: vegetated and bare classes only.
     10 tree  20 shrub  30 grass  40 crop  60 bare
   Excluded: built (50), water (80), wetland (90), mangrove (95).
   Wetland and mangrove are excluded because Mumbai's creeks are
   tidally inundated and thermally behave like water. */
var isRuralCover = worldcover.eq(10).or(worldcover.eq(20))
  .or(worldcover.eq(30)).or(worldcover.eq(40)).or(worldcover.eq(60));

// Geometry restrictions as images so masks compose cleanly.
var inCity  = ee.Image.constant(1).clip(aoi).mask().gt(0);
var inRural = ee.Image.constant(1).clip(ruralZone).mask().gt(0);

var urbanMask = isBuilt.and(inCity).and(isWater.not())
                  .selfMask().rename('urban');
var ruralMask = isRuralCover.and(inRural).and(isWater.not()).and(isWetland.not())
                  .selfMask().rename('rural');

// Variant rural ring, for the geometry sensitivity test.
function ruralMaskForRing(innerM, outerM) {
  var ring   = aoi.buffer(outerM).difference(aoi.buffer(innerM), 1);
  var inRing = ee.Image.constant(1).clip(ring).mask().gt(0);
  return {
    mask: isRuralCover.and(inRing).and(isWater.not()).and(isWetland.not()).selfMask(),
    geom: ring
  };
}

/* Rural mask that DOES include water — used only in section H to
   demonstrate what excluding water is worth. Parenthesised so the
   ring restriction applies to the whole land-cover union rather than
   binding only to the last .or() term. */
var ruralMaskWithWater = (isRuralCover.or(isWater).or(isWetland))
  .and(inRural).selfMask().rename('rural_ww');


/* ---- Zone visualisation ---------------------------------- */

Map.centerObject(aoi, 10);
Map.setOptions('HYBRID');

// Ring as an outline, so the basemap stays readable underneath.
Map.addLayer(ee.Image().byte().paint({
  featureCollection: ee.FeatureCollection([ee.Feature(ruralZone)]),
  color: 1, width: 2}), {palette: ['00ffff']}, '1. Rural ring outline (5-20 km)', true);

Map.addLayer(ee.Image().byte().paint({
  featureCollection: aoiFC, color: 1, width: 3}),
  {palette: ['ffff00']}, '2. AOI boundary (Mumbai City district)', true);

// Semi-transparent fill showing the ring footprint before masking.
Map.addLayer(ee.Image().byte().paint({
  featureCollection: ee.FeatureCollection([ee.Feature(ruralZone)]), color: 1}),
  {palette: ['ffffff'], opacity: 0.15}, '3. Rural ring footprint (unmasked)', false);

Map.addLayer(worldcover, {min: 10, max: 100, palette: [
  '006400', 'ffbb22', 'ffff4c', 'f096ff', 'fa0000', 'b4b4b4',
  'f0f0f0', '0064c8', '0096a0', '00cf75', 'fae6a0']},
  '4. ESA WorldCover 2021', false);

Map.addLayer(isWater.selfMask(), {palette: ['0064c8']},
  '5. Water excluded (class 80)', false);
Map.addLayer(isWetland.selfMask(), {palette: ['00cf75']},
  '6. Wetland/mangrove excluded (90, 95)', false);

Map.addLayer(urbanMask, {palette: ['e31a1c']}, '7. URBAN zone (final)', true);
Map.addLayer(ruralMask, {palette: ['33a02c']}, '8. RURAL zone (final)', true);

// Legend.
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 10px'}});
legend.add(ui.Label('Zone definitions', {fontWeight: 'bold', fontSize: '13px'}));
[['e31a1c', 'Urban — built-up, inside district'],
 ['33a02c', 'Rural — veg/bare, 5-20 km ring'],
 ['0064c8', 'Water — excluded from both'],
 ['00cf75', 'Wetland/mangrove — excluded'],
 ['ffff00', 'District boundary'],
 ['00ffff', 'Rural ring edge']].forEach(function (r) {
  legend.add(ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    widgets: [
      ui.Label('', {backgroundColor: '#' + r[0], padding: '8px', margin: '0 8px 3px 0'}),
      ui.Label(r[1], {fontSize: '11px', margin: '2px 0 0 0'})
    ]}));
});
Map.add(legend);


/* ============================================================
   C)  SETUP DIAGNOSTICS
   ============================================================
   Run once. Record every number — they fill the report's study
   area and water-exclusion paragraphs. If rural area comes back
   near zero, stop: everything downstream is meaningless.
   ============================================================ */

var pxArea = ee.Image.pixelArea().divide(1e6);   // km2 per pixel

function areaOf(mask, geom) {
  return pxArea.updateMask(mask).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: geom,
    scale: 100, maxPixels: MAX_PIXELS}).get('area');
}

print('================ SETUP DIAGNOSTICS ================');
print('AOI: GADM v4.1 level-2, Mumbai City district');
print('AOI area, ellipsoidal (km2):', AOI_AREA_KM2);
print('AOI area, GADM attribute (km2):', aoiFC.first().get('area_km2'));
print('Rural ring: ' + RURAL_INNER_M / 1000 + '-' + RURAL_OUTER_M / 1000 + ' km');

print('-- Zone areas --');
print('Urban zone, built-up in district (km2):', areaOf(urbanMask, aoi));
print('Rural zone, final after exclusions (km2):', areaOf(ruralMask, ruralZone));

print('-- Composition of the rural ring (the water argument) --');
var ringTotal = pxArea.clip(ruralZone).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: ruralZone,
  scale: 100, maxPixels: MAX_PIXELS}).get('area');
print('Ring geometric area (km2):', ringTotal);
print('  water, class 80 (km2):',   areaOf(isWater.and(inRural), ruralZone));
print('  wetland+mangrove (km2):',  areaOf(isWetland.and(inRural), ruralZone));
print('  built-up, class 50 (km2):', areaOf(isBuilt.and(inRural), ruralZone));
print('  usable rural cover (km2):', areaOf(ruralMask, ruralZone));
print('NOTE: record the water percentage — it is the evidence for excluding it.');

/* Valid-pixel audit. If any row shows 0 for a zone, that combination
   yields a null UHI and the QC screening is the likely cause: set
   QC_STRICT = false, or widen the year range. Run this before
   trusting any result below. */
print('-- Valid MODIS pixels per zone (QC_STRICT = ' + QC_STRICT + ') --');
var auditRows = [];
PLATFORMS.forEach(function (platform) {
  MODES.forEach(function (mode) {
    SEASONS.forEach(function (season) {
      var c = seasonComposite(platform, mode, season, YEAR_START, YEAR_END);
      auditRows.push(ee.Feature(null, {
        platform: platform.name, mode: mode.name, season: season.name,
        n_composites: c.nImages,
        urban_px: zonalStats(c.lst, urbanMask, aoi).get('LST_C_count'),
        rural_px: zonalStats(c.lst, ruralMask, ruralZone).get('LST_C_count')
      }));
    });
  });
});
var pixelAudit = ee.FeatureCollection(auditRows);
print(pixelAudit);


/* ============================================================
   D)  MODIS HELPERS
   ============================================================ */

/* QC_Day / QC_Night bit layout (EE catalogue / LP DAAC user guide):
     bits 0-1  mandatory QA    0 good, 1 unreliable, 2 cloud, 3 other
     bits 2-3  data quality    0 good, 1 other quality
     bits 4-5  emissivity err  0 <=0.01, 1 <=0.02, 2 <=0.04, 3 >0.04
     bits 6-7  LST error       0 <=1K, 1 <=2K, 2 <=3K, 3 >3K

   QC_STRICT controls how aggressive the screening is:
     true  — mandatory QA == 0 AND LST error <= 2 K
     false — mandatory QA <= 1 AND LST error <= 3 K

   The strict setting can empty a zone entirely for night retrievals
   over a coastal city, which propagates as a null zonal mean. The
   relaxed setting is the documented fallback; whichever is used must
   be stated in the report, and the two can be compared as a further
   sensitivity test. */
var QC_STRICT = false;

function maskQC(img, qcBand) {
  var qc  = img.select(qcBand);
  var qa  = qc.bitwiseAnd(3);
  var err = qc.rightShift(6).bitwiseAnd(3);
  var keep = QC_STRICT
    ? qa.eq(0).and(err.lte(1))
    : qa.lte(1).and(err.lte(2));
  return img.updateMask(keep);
}

function prepMODIS(img, mode) {
  return img.select(mode.lstBand).multiply(LST_SCALE).subtract(273.15).rename('LST_C')
    .addBands(img.select(mode.viewBand).multiply(VIEW_TIME_SCALE).rename('view_time'))
    .copyProperties(img, ['system:time_start']);
}

function seasonComposite(platform, mode, season, yStart, yEnd) {
  var col = ee.ImageCollection(platform.id)
    .filterBounds(analysisExtent)
    .filter(ee.Filter.calendarRange(yStart, yEnd, 'year'))
    .filter(ee.Filter.calendarRange(season.startMonth, season.endMonth, 'month'))
    .map(function (i) { return maskQC(i, mode.qcBand); })
    .map(function (i) { return prepMODIS(i, mode); });

  return {
    lst:      col.select('LST_C').mean().clip(analysisExtent),
    viewTime: col.select('view_time').mean(),
    nObs:     col.select('LST_C').count().clip(analysisExtent),
    nImages:  col.size()
  };
}

function zonalStats(img, mask, geom) {
  return img.updateMask(mask).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.count(),  sharedInputs: true}),
    geometry: geom, scale: STATS_SCALE_M, maxPixels: MAX_PIXELS});
}

/* Null-safe difference. reduceRegion returns null for a band when a
   zone contains no unmasked pixels, and ee.Number(null).subtract()
   throws "Parameter 'left' is required and may not be null", which
   fails the whole FeatureCollection rather than the one row. Returning
   null for that row instead keeps the rest of the table computable and
   makes the empty zone visible in the output. */
function safeDiff(a, b) {
  return ee.Algorithms.If(
    ee.Algorithms.IsEqual(a, null), null,
    ee.Algorithms.If(
      ee.Algorithms.IsEqual(b, null), null,
      ee.Number(a).subtract(ee.Number(b))));
}

function computeUHI(img, rMask, rGeom) {
  rMask = rMask || ruralMask;
  rGeom = rGeom || ruralZone;
  var u = zonalStats(img, urbanMask, aoi);
  var r = zonalStats(img, rMask, rGeom);
  return ee.Dictionary({
    urban_mean:  u.get('LST_C_mean'),  urban_sd: u.get('LST_C_stdDev'),
    urban_count: u.get('LST_C_count'),
    rural_mean:  r.get('LST_C_mean'),  rural_sd: r.get('LST_C_stdDev'),
    rural_count: r.get('LST_C_count'),
    uhi: safeDiff(u.get('LST_C_mean'), r.get('LST_C_mean'))
  });
}


/* ============================================================
   E)  HEADLINE RESULTS
   ============================================================ */

var headlineRows = [];

PLATFORMS.forEach(function (platform) {
  MODES.forEach(function (mode) {
    SEASONS.forEach(function (season) {
      var comp  = seasonComposite(platform, mode, season, YEAR_START, YEAR_END);
      var stats = computeUHI(comp.lst);

      var obsU = comp.nObs.updateMask(urbanMask).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: aoi,
        scale: STATS_SCALE_M, maxPixels: MAX_PIXELS}).get('LST_C');
      var obsR = comp.nObs.updateMask(ruralMask).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: ruralZone,
        scale: STATS_SCALE_M, maxPixels: MAX_PIXELS}).get('LST_C');

      // Actual mean local solar observation time, not the nominal one.
      var vtU = comp.viewTime.updateMask(urbanMask).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: aoi,
        scale: STATS_SCALE_M, maxPixels: MAX_PIXELS}).get('view_time');

      headlineRows.push(ee.Feature(null, stats.combine(ee.Dictionary({
        platform: platform.name, mode: mode.name, season: season.name,
        nominal_time: mode.name === 'Day' ? platform.dayLocal : platform.nightLocal,
        obs_time_mean: vtU, n_composites: comp.nImages,
        obs_urban: obsU, obs_rural: obsR,
        years: YEAR_START + '-' + YEAR_END
      }))));
    });
  });
});

var headline = ee.FeatureCollection(headlineRows);
print('=========== E) SEASONAL UHI, ' + YEAR_START + '-' + YEAR_END + ' ===========', headline);


/* ============================================================
   F)  SENSITIVITY 1 — INTERANNUAL SPREAD
   ============================================================ */

var yearRows = [];
for (var y = YEAR_START; y <= YEAR_END; y++) {
  SEASONS.forEach(function (season) {
    var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, y, y);
    yearRows.push(ee.Feature(null, computeUHI(comp.lst).combine(ee.Dictionary({
      platform: SENS_PLATFORM.name, mode: SENS_MODE.name,
      season: season.name, year: y, n_composites: comp.nImages
    }))));
  });
}
var perYear = ee.FeatureCollection(yearRows);
print('=========== F) INTERANNUAL SPREAD (' + SENS_PLATFORM.name + ' ' +
      SENS_MODE.name + ') ===========', perYear);


/* ============================================================
   G)  SENSITIVITY 2 — RURAL RING GEOMETRY
   ============================================================ */

var RING_VARIANTS = [
  {inner: 2000,  outer: 20000},
  {inner: 5000,  outer: 20000},   // headline
  {inner: 10000, outer: 25000},
  {inner: 5000,  outer: 30000}
];

var ringRows = [];
RING_VARIANTS.forEach(function (v) {
  SEASONS.forEach(function (season) {
    var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, YEAR_START, YEAR_END);
    var rr   = ruralMaskForRing(v.inner, v.outer);
    ringRows.push(ee.Feature(null, computeUHI(comp.lst, rr.mask, rr.geom)
      .combine(ee.Dictionary({
        platform: SENS_PLATFORM.name, mode: SENS_MODE.name, season: season.name,
        ring: (v.inner / 1000) + '-' + (v.outer / 1000) + ' km'
      }))));
  });
});
var ringSweep = ee.FeatureCollection(ringRows);
print('=========== G) RURAL RING SENSITIVITY ===========', ringSweep);


/* ============================================================
   H)  SENSITIVITY 3 — WATER INCLUSION
   ============================================================
   Quantifies what excluding water and wetland is worth, for both
   day and night. Expect the two to move in OPPOSITE directions:
   sea is cooler than land by day and warmer by night, so
   including it inflates day UHI and suppresses night UHI.
   ============================================================ */

var waterRows = [];
MODES.forEach(function (mode) {
  SEASONS.forEach(function (season) {
    var comp = seasonComposite(SENS_PLATFORM, mode, season, YEAR_START, YEAR_END);
    var excl = computeUHI(comp.lst, ruralMask,          ruralZone);
    var incl = computeUHI(comp.lst, ruralMaskWithWater, ruralZone);
    waterRows.push(ee.Feature(null, ee.Dictionary({
      platform: SENS_PLATFORM.name, mode: mode.name, season: season.name,
      uhi_water_excluded: excl.get('uhi'),
      uhi_water_included: incl.get('uhi'),
      rural_mean_excluded: excl.get('rural_mean'),
      rural_mean_included: incl.get('rural_mean'),
      difference: safeDiff(incl.get('uhi'), excl.get('uhi'))
    })));
  });
});
var waterTest = ee.FeatureCollection(waterRows);
print('=========== H) WATER INCLUSION TEST ===========', waterTest);


/* ============================================================
   I)  MAPS
   ============================================================ */

SEASONS.forEach(function (season) {
  var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, YEAR_START, YEAR_END);
  var pfx  = SENS_PLATFORM.name + ' ' + SENS_MODE.name + ' — ';

  Map.addLayer(comp.lst, VIS_LST, pfx + 'LST ' + season.name, false);

  var rMean = ee.Number(zonalStats(comp.lst, ruralMask, ruralZone).get('LST_C_mean'));
  Map.addLayer(comp.lst.subtract(rMean), VIS_ANOM,
    pfx + 'Anomaly ' + season.name, false);

  // Valid-observation count. Compare the monsoon layer against the
  // others — this is the clear-sky sampling-bias figure.
  Map.addLayer(comp.nObs, VIS_OBS, pfx + 'Valid obs count ' + season.name, false);
});

// LST legend.
var lstLegend = ui.Panel({style: {position: 'bottom-right', padding: '8px 10px'}});
lstLegend.add(ui.Label('MODIS LST (deg C)', {fontWeight: 'bold', fontSize: '12px'}));
lstLegend.add(ui.Thumbnail({
  image: ee.Image.pixelLonLat().select('longitude')
           .multiply((VIS_LST.max - VIS_LST.min) / 100).add(VIS_LST.min),
  params: {bbox: [0, 0, 100, 8], dimensions: '180x18',
           min: VIS_LST.min, max: VIS_LST.max, palette: VIS_LST.palette},
  style: {padding: '0', position: 'bottom-center'}}));
lstLegend.add(ui.Panel({
  layout: ui.Panel.Layout.Flow('horizontal'),
  widgets: [ui.Label(VIS_LST.min + '', {fontSize: '10px', margin: '0 60px 0 0'}),
            ui.Label(VIS_LST.max + '', {fontSize: '10px'})]}));
Map.add(lstLegend);


/* ============================================================
   J)  CHARTS
   ============================================================ */

print(ui.Chart.feature.groups({
  features: headline.filter(ee.Filter.eq('mode', 'Day')),
  xProperty: 'season', yProperty: 'uhi', seriesProperty: 'platform'
}).setChartType('ColumnChart').setOptions({
  title: 'Daytime seasonal SUHI, Mumbai (' + YEAR_START + '-' + YEAR_END + ')',
  vAxis: {title: 'UHI intensity (deg C)'}, hAxis: {title: 'Season'}}));

print(ui.Chart.feature.groups({
  features: headline.filter(ee.Filter.eq('mode', 'Night')),
  xProperty: 'season', yProperty: 'uhi', seriesProperty: 'platform'
}).setChartType('ColumnChart').setOptions({
  title: 'Night-time seasonal SUHI, Mumbai (' + YEAR_START + '-' + YEAR_END + ')',
  vAxis: {title: 'UHI intensity (deg C)'}, hAxis: {title: 'Season'}}));

print(ui.Chart.feature.groups({
  features: perYear, xProperty: 'year', yProperty: 'uhi', seriesProperty: 'season'
}).setChartType('LineChart').setOptions({
  title: 'Interannual variation in seasonal SUHI',
  vAxis: {title: 'UHI intensity (deg C)'}, hAxis: {title: 'Year', format: '####'},
  pointSize: 5}));

print(ui.Chart.feature.groups({
  features: ringSweep, xProperty: 'ring', yProperty: 'uhi', seriesProperty: 'season'
}).setChartType('ColumnChart').setOptions({
  title: 'Sensitivity of SUHI to rural ring definition',
  vAxis: {title: 'UHI intensity (deg C)'}, hAxis: {title: 'Ring (km from boundary)'}}));

// Urban vs rural distribution, per season.
SEASONS.forEach(function (season) {
  var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, YEAR_START, YEAR_END);
  print(ui.Chart.image.histogram({
    image: comp.lst.updateMask(urbanMask).rename('Urban')
             .addBands(comp.lst.updateMask(ruralMask).rename('Rural')),
    region: analysisExtent, scale: STATS_SCALE_M,
    maxPixels: MAX_PIXELS, minBucketWidth: 0.25
  }).setSeriesNames(['Urban', 'Rural']).setOptions({
    title: 'LST distribution, urban vs rural — ' + season.name,
    hAxis: {title: 'LST (deg C)'}, vAxis: {title: 'Pixel count'},
    colors: ['b2182b', '2a9d8f']}));
});


/* ============================================================
   L)  CROSS-SENSOR COMPARISON RUN  (matched to Landsat year)
   ============================================================
   M's Landsat pair is 8-9 October 2015, i.e. post-monsoon 2015.
   The headline numbers above are 2019-2023 means, so comparing
   them directly against a 2015 scene would confound season with
   an eight-year gap.

   This section repeats the post-monsoon calculation for 2015
   alone, on both platforms and both modes, giving a like-for-like
   row for the comparison table. The difference between this and
   the 2019-2023 post-monsoon figure is itself worth reporting:
   it separates interannual variability from the sensor and
   time-of-day effects the comparison is meant to isolate.
   ============================================================ */

var compareRows = [];

PLATFORMS.forEach(function (platform) {
  MODES.forEach(function (mode) {

    // Single-year, matched to the Landsat acquisition.
    var c2015 = seasonComposite(platform, mode, COMPARISON_SEASON,
                                LANDSAT_YEAR, LANDSAT_YEAR);
    var s2015 = computeUHI(c2015.lst);

    var vt2015 = c2015.viewTime.updateMask(urbanMask).reduceRegion({
      reducer: ee.Reducer.mean(), geometry: aoi,
      scale: STATS_SCALE_M, maxPixels: MAX_PIXELS}).get('view_time');

    compareRows.push(ee.Feature(null, s2015.combine(ee.Dictionary({
      platform: platform.name, mode: mode.name,
      season: COMPARISON_SEASON.name,
      period: String(LANDSAT_YEAR) + ' only (matched to Landsat)',
      nominal_time: mode.name === 'Day' ? platform.dayLocal : platform.nightLocal,
      obs_time_mean: vt2015,
      n_composites: c2015.nImages
    }))));

    // Multi-year equivalent, for the interannual context.
    var cMulti = seasonComposite(platform, mode, COMPARISON_SEASON,
                                 YEAR_START, YEAR_END);
    compareRows.push(ee.Feature(null, computeUHI(cMulti.lst).combine(ee.Dictionary({
      platform: platform.name, mode: mode.name,
      season: COMPARISON_SEASON.name,
      period: YEAR_START + '-' + YEAR_END + ' mean',
      nominal_time: mode.name === 'Day' ? platform.dayLocal : platform.nightLocal,
      obs_time_mean: null,
      n_composites: cMulti.nImages
    }))));
  });
});

var comparisonRun = ee.FeatureCollection(compareRows);
print('=========== L) CROSS-SENSOR COMPARISON (' +
      COMPARISON_SEASON.name + ') ===========', comparisonRun);
print('Landsat reference: 8 Oct 2015 day (L2 ST_B10), 9 Oct 2015 night (L1 BT).');
print('Compare the ' + LANDSAT_YEAR + '-only rows against M\'s Landsat UHI.');

// Post-monsoon 2015 maps, for a side-by-side figure with M's scene.
var comp2015 = seasonComposite(SENS_PLATFORM, SENS_MODE,
                               COMPARISON_SEASON, LANDSAT_YEAR, LANDSAT_YEAR);
Map.addLayer(comp2015.lst, VIS_LST,
  SENS_PLATFORM.name + ' ' + SENS_MODE.name + ' — LST ' +
  COMPARISON_SEASON.name + ' ' + LANDSAT_YEAR, false);

print(ui.Chart.feature.groups({
  features: comparisonRun.filter(ee.Filter.eq('mode', 'Day')),
  xProperty: 'period', yProperty: 'uhi', seriesProperty: 'platform'
}).setChartType('ColumnChart').setOptions({
  title: 'Post-monsoon daytime SUHI: 2015 vs ' + YEAR_START + '-' + YEAR_END,
  vAxis: {title: 'UHI intensity (deg C)'}, hAxis: {title: 'Period'}}));


/* ============================================================
   K)  EXPORTS
   ============================================================
   Run from the Tasks tab once the printed numbers look right.
   ============================================================ */

Export.table.toDrive({
  collection: comparisonRun, description: 'Mumbai_MODIS_Landsat_Comparison',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'period', 'nominal_time',
              'obs_time_mean', 'urban_mean', 'rural_mean', 'uhi',
              'urban_count', 'rural_count', 'n_composites']});

Export.table.toDrive({
  collection: headline, description: 'Mumbai_MODIS_Seasonal_UHI_headline',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'years', 'nominal_time', 'obs_time_mean',
              'urban_mean', 'urban_sd', 'urban_count',
              'rural_mean', 'rural_sd', 'rural_count', 'uhi',
              'n_composites', 'obs_urban', 'obs_rural']});

Export.table.toDrive({
  collection: perYear, description: 'Mumbai_MODIS_Seasonal_UHI_perYear',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'year',
              'urban_mean', 'rural_mean', 'uhi',
              'urban_count', 'rural_count', 'n_composites']});

Export.table.toDrive({
  collection: ringSweep, description: 'Mumbai_MODIS_RuralRing_Sensitivity',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'ring',
              'urban_mean', 'rural_mean', 'uhi', 'urban_count', 'rural_count']});

Export.table.toDrive({
  collection: waterTest, description: 'Mumbai_MODIS_WaterExclusion_Test',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'uhi_water_excluded',
              'uhi_water_included', 'rural_mean_excluded',
              'rural_mean_included', 'difference']});

Export.table.toDrive({
  collection: pixelAudit, description: 'Mumbai_MODIS_PixelAudit',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['platform', 'mode', 'season', 'n_composites',
              'urban_px', 'rural_px']});

/* ---- Chart source data -------------------------------------
   GEE cannot export a rendered chart image. Every chart above is
   driven by one of the FeatureCollections already exported as CSV,
   so the charts are reproducible in Excel or Python from those
   files. The histograms are the exception — their underlying
   binned counts are not in any table — so they are exported
   explicitly below as per-season urban/rural pixel histograms.
   ------------------------------------------------------------ */

function histogramTable(season) {
  var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, YEAR_START, YEAR_END);
  var urbanVals = comp.lst.updateMask(urbanMask).rename('LST_C')
    .sample({region: aoi, scale: STATS_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Urban', 'season', season.name); });
  var ruralVals = comp.lst.updateMask(ruralMask).rename('LST_C')
    .sample({region: ruralZone, scale: STATS_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Rural', 'season', season.name); });
  return urbanVals.merge(ruralVals);
}

var allHistograms = ee.FeatureCollection(
  SEASONS.map(function (s) { return histogramTable(s); })).flatten();

Export.table.toDrive({
  collection: allHistograms, description: 'Mumbai_MODIS_Distribution_PixelValues',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'CSV',
  selectors: ['season', 'zone', 'LST_C']});

/* ---- Seasonal raster exports ------------------------------- */

SEASONS.forEach(function (season) {
  var comp = seasonComposite(SENS_PLATFORM, SENS_MODE, season, YEAR_START, YEAR_END);
  var tag  = SENS_PLATFORM.name + '_' + SENS_MODE.name + '_' + season.name;

  Export.image.toDrive({
    image: comp.lst, description: 'Mumbai_MODIS_LST_' + tag,
    folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
    scale: STATS_SCALE_M, maxPixels: MAX_PIXELS});

  // Anomaly raster, against that season's own rural mean.
  var rMean = ee.Number(zonalStats(comp.lst, ruralMask, ruralZone).get('LST_C_mean'));
  Export.image.toDrive({
    image: comp.lst.subtract(rMean), description: 'Mumbai_MODIS_Anomaly_' + tag,
    folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
    scale: STATS_SCALE_M, maxPixels: MAX_PIXELS});

  // Valid-observation count — the sampling-bias figure.
  Export.image.toDrive({
    image: comp.nObs, description: 'Mumbai_MODIS_ValidObs_' + tag,
    folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
    scale: STATS_SCALE_M, maxPixels: MAX_PIXELS});
});

// Post-monsoon 2015 raster, for the side-by-side with M's Landsat scene.
Export.image.toDrive({
  image: comp2015.lst,
  description: 'Mumbai_MODIS_LST_' + SENS_PLATFORM.name + '_' +
               SENS_MODE.name + '_PostMonsoon_' + LANDSAT_YEAR,
  folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
  scale: STATS_SCALE_M, maxPixels: MAX_PIXELS});

// Zone masks, so the report figures can show them over a basemap.
Export.image.toDrive({
  image: urbanMask.unmask(0).byte(), description: 'Mumbai_Zone_Urban',
  folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
  scale: 100, maxPixels: MAX_PIXELS});

Export.image.toDrive({
  image: ruralMask.unmask(0).byte(), description: 'Mumbai_Zone_Rural',
  folder: 'Mumbai_UHI_Assignment', region: analysisExtent,
  scale: 100, maxPixels: MAX_PIXELS});

Export.table.toDrive({
  collection: ee.FeatureCollection([ee.Feature(ruralZone, {name: 'rural_ring'})]),
  description: 'Mumbai_Zone_RuralRing_Geometry',
  folder: 'Mumbai_UHI_Assignment', fileFormat: 'SHP'});
