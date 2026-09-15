/************************************************************
 PART A — DAY AND NIGHT UHI FROM LANDSAT 8
 Mumbai  ·  corrected version
 ============================================================
 Changes from v1, and why each one matters:

  1. RURAL REFERENCE moved outside the city.
     v1 used non-built pixels INSIDE the boundary, which sit in
     the urban plume. That is the main reason v1's night UHI came
     out at 0.32 C. Now a 5-20 km external ring, identical to
     Part B, so the two parts are comparable.

  2. WATER EXCLUDED from both zones.
     Mumbai is a peninsula. v1 kept class 80, and sea is cooler
     than land by day and warmer by night, which inflates day UHI
     and suppresses night UHI.

  3. WETLAND AND MANGROVE excluded from the rural reference.
     Tidally inundated, thermally water-like.

  4. NIGHT EMISSIVITY CORRECTION added.
     v1 reported brightness temperature only. Now both BT and
     emissivity-corrected LST are computed, so the report can say
     what the correction was worth.

  5. RADIANCE CONSTANTS read from scene metadata.
     v1 hard-coded 0.0003342 / 0.1. Now uses the image's own
     RADIANCE_MULT_BAND_10 and RADIANCE_ADD_BAND_10, and its own
     K1/K2.

  6. SENSITIVITY is now a sweep, not two points.
     The brief asks for a parameter varied across a range.

  7. ANOMALY MAPS no longer masked to urban only.
     v1 masked them to the urban zone, which hides the contrast
     the map exists to show.

  8. STATS SCALE 30 m -> 100 m, and geometry simplified.
     The analysis extent is the district plus a 20 km buffer,
     ~2800 km2. At 30 m that is ~3.1 billion pixels, which exceeds
     Earth Engine's interactive memory budget. Statistics run at
     100 m, diagnostics at 200-300 m, and the ring geometry is
     simplified to 100 m so each reducer call stops re-evaluating
     tens of thousands of coastline vertices. Exports still run at
     full 30 m — batch tasks are not subject to the interactive
     limit.

  9. VALID-PIXEL FRACTION reported per scene.
     The brief asks for it explicitly.

 RUN: paste into the Code Editor and run top to bottom.
 ************************************************************/


/* ============================================================
   A)  PARAMETERS
   ============================================================ */

var AOI_ASSET = 'projects/ee-ujjwalguptaug0611/assets/Mumbai_AOI_FINAL';

// Scenes. Day is Tier-1 Level-2; night is Tier-2 Level-1, because
// no Level-2 surface temperature is produced for night passes.
var DAY_SCENE   = 'LANDSAT/LC08/C02/T1_L2/LC08_148047_20151008';
var NIGHT_SCENE = 'LANDSAT/LC08/C02/T2/LC08_018197_20151009';

// Rural ring, metres beyond the boundary. Same as Part B.
var RURAL_INNER_M = 5000;
var RURAL_OUTER_M = 20000;

// Collection-2 Level-2 scale factors (USGS product guide).
var ST_MULT = 0.00341802, ST_ADD = 149.0;

/* Band-10 centre wavelength and the second radiation constant,
   for the emissivity correction. */
var LAMBDA_B10 = 10.895e-6;   // m
var C2         = 1.4388e-2;   // m K

/* Class-based emissivity. Night has no usable reflective bands,
   so NDVI-based emissivity is unavailable and a land-cover
   lookup is the standard substitute. */
var EMIS = {built: 0.970, veg: 0.985, bare: 0.960, water: 0.990};

/* Statistics scale. Landsat native is 30 m, but the analysis extent
   is the district plus a 20 km buffer — roughly 2800 km2 — and at
   30 m that is ~3.1 billion pixels, which exceeds Earth Engine's
   memory budget for reduceRegion. 100 m keeps the computation inside
   the budget while staying well below the 1 km MODIS grid, so the
   Landsat result remains the higher-resolution of the two.
   Report this number: the brief asks at what scale zonal means were
   computed. Raise to 60 if you hit no memory errors; lower to 200 if
   you still do. */
var STATS_SCALE_M  = 100;
var SAMPLE_SCALE_M = 200;   // pixel sampling for the exported CSV

/* Histograms get their own, coarser scale. ui.Chart.image.histogram()
   does NOT accept bestEffort — it is a reduceRegion parameter, not a
   chart parameter — so the only way to keep the chart inside the
   memory budget is to ask for a coarser grid up front. 300 m over the
   full extent is ample for a distribution plot: the shape of the
   histogram is what matters, not the pixel count. */
var HIST_SCALE_M   = 300;

var MAX_PIXELS     = 1e10;

/* Geometry simplification tolerance, metres. The GADM polygon has
   tens of thousands of vertices along a complex coastline; buffering
   and differencing it unsimplified is what makes the ring geometry
   expensive to evaluate on every reducer call. 100 m is far below
   the statistics scale, so this costs nothing in accuracy. */
var GEOM_TOLERANCE_M = 100;

var VIS_LST = {min: 22, max: 45,
  palette: ['040274', '2166ac', '67a9cf', 'd1e5f0', 'fddbc7', 'ef8a62', 'b2182b']};
var VIS_BT = {min: 16, max: 26,
  palette: ['040274', '2166ac', '67a9cf', 'd1e5f0', 'fddbc7', 'ef8a62', 'b2182b']};
var VIS_ANOM = {min: -4, max: 8,
  palette: ['2166ac', '67a9cf', 'f7f7f7', 'fddbc7', 'ef8a62', 'b2182b']};


/* ============================================================
   B)  AOI AND ZONES   (identical logic to Part B)
   ============================================================ */

var aoiFC = ee.FeatureCollection(AOI_ASSET);

/* Full-resolution geometry. Used only for the area figure quoted in
   the report and for drawing the boundary outline. */
var aoiFull = aoiFC.geometry();
var AOI_AREA_KM2 = aoiFull.area({maxError: 1}).divide(1e6);

/* Simplified geometry for everything computational.

   maxError on simplify() and on the buffers is what actually bounds
   the cost. Calling .simplify() alone still forces Earth Engine to
   walk every vertex of the original coastline, and repeating that
   inside each buffer and difference is what exhausted memory. Passing
   maxError to the buffer and difference operations lets them work at
   the same tolerance instead of at full precision.

   ee.Geometry constructors are evaluated once and cached, so building
   the ring here rather than inside a function means the cost is paid
   a single time rather than on every reducer call. */
var aoi = aoiFull.simplify({maxError: GEOM_TOLERANCE_M});

var aoiBufOuter = aoi.buffer({distance: RURAL_OUTER_M, maxError: GEOM_TOLERANCE_M});
var aoiBufInner = aoi.buffer({distance: RURAL_INNER_M, maxError: GEOM_TOLERANCE_M});

var ruralZone      = aoiBufOuter.difference({right: aoiBufInner, maxError: GEOM_TOLERANCE_M});
var analysisExtent = aoiBufOuter;

// Clipped to the BUFFERED extent — clipping to the city empties
// the rural mask.
var worldcover = ee.ImageCollection('ESA/WorldCover/v200')
  .first().select('Map').clip(analysisExtent);

var isBuilt   = worldcover.eq(50);
var isWater   = worldcover.eq(80);
var isWetland = worldcover.eq(90).or(worldcover.eq(95));

var isRuralCover = worldcover.eq(10).or(worldcover.eq(20))
  .or(worldcover.eq(30)).or(worldcover.eq(40)).or(worldcover.eq(60));

var inCity  = ee.Image.constant(1).clip(aoi).mask().gt(0);
var inRural = ee.Image.constant(1).clip(ruralZone).mask().gt(0);

var urbanMask = isBuilt.and(inCity).and(isWater.not())
                  .selfMask().rename('urban');
var ruralMask = isRuralCover.and(inRural).and(isWater.not()).and(isWetland.not())
                  .selfMask().rename('rural');

function ruralMaskForRing(innerM, outerM) {
  var ring = aoi.buffer({distance: outerM, maxError: GEOM_TOLERANCE_M})
    .difference({
      right: aoi.buffer({distance: innerM, maxError: GEOM_TOLERANCE_M}),
      maxError: GEOM_TOLERANCE_M});
  var inRing = ee.Image.constant(1).clip(ring).mask().gt(0);
  return {
    mask: isRuralCover.and(inRing).and(isWater.not()).and(isWetland.not()).selfMask(),
    geom: ring
  };
}

/* The v1 rural definition: non-built pixels INSIDE the city.
   Kept so the report can show what changing it was worth. */
var ruralMaskInternal = isRuralCover.or(isWetland).or(worldcover.eq(100))
  .and(inCity).selfMask().rename('rural_internal');


/* ============================================================
   C)  MASKING AND CONVERSION HELPERS
   ============================================================ */

/* QA_PIXEL bits, identical on Level-1 and Level-2:
     0 fill  1 dilated cloud  2 cirrus  3 cloud
     4 cloud shadow  5 snow  6 clear  7 water
   Bits 0-5 masked in one operation. Bit 6 and 7 left alone —
   water is handled through WorldCover so both parts treat it
   the same way. */
function maskQA(image) {
  var bad = image.select('QA_PIXEL').bitwiseAnd(parseInt('111111', 2)).neq(0);
  return image.updateMask(bad.not());
}

/* Fraction of pixels surviving the QA mask. Computed at a coarser
   scale than the statistics: this is a diagnostic ratio, not a
   temperature, so it does not need the full grid, and evaluating
   .mask() over the whole buffered extent at 100 m is what exhausted
   memory in the first version. */
function validFraction(img, geom, scale) {
  return img.mask().reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom,
    scale: scale || 300, maxPixels: MAX_PIXELS, bestEffort: true
  }).values().get(0);
}

// Class-based emissivity from WorldCover.
function emissivityFromWorldCover(wc) {
  var built = wc.eq(50).multiply(EMIS.built);
  var water = wc.eq(80).multiply(EMIS.water);
  var veg   = wc.eq(10).or(wc.eq(30)).or(wc.eq(40)).or(wc.eq(20))
                .or(wc.eq(90)).or(wc.eq(95)).multiply(EMIS.veg);
  var bare  = wc.eq(60).or(wc.eq(100)).multiply(EMIS.bare);
  var eps   = built.add(water).add(veg).add(bare).rename('emissivity');
  return eps.updateMask(eps.gt(0));
}

/* Single-channel emissivity correction, BT -> LST:
     LST = BT / [ 1 + (lambda * BT / c2) * ln(eps) ]        */
function lstFromBT(btK, eps) {
  var term = ee.Image.constant(LAMBDA_B10).multiply(btK)
               .divide(ee.Image.constant(C2)).multiply(eps.log());
  return btK.divide(ee.Image(1).add(term));
}


/* ============================================================
   D)  DAYTIME LST   (Level-2 product)
   ============================================================ */

var dayRaw = ee.Image(DAY_SCENE);
var dayLST = maskQA(dayRaw).select('ST_B10')
  .multiply(ST_MULT).add(ST_ADD).subtract(273.15)
  .rename('LST').clip(analysisExtent);


/* ============================================================
   E)  NIGHT-TIME BT AND LST   (Level-1)
   ============================================================ */

var nightRaw    = ee.Image(NIGHT_SCENE);
var nightMasked = maskQA(nightRaw);

// Constants from the scene's own metadata, never hard-coded.
var M_L = ee.Number(nightRaw.get('RADIANCE_MULT_BAND_10'));
var A_L = ee.Number(nightRaw.get('RADIANCE_ADD_BAND_10'));
var K1  = ee.Number(nightRaw.get('K1_CONSTANT_BAND_10'));
var K2  = ee.Number(nightRaw.get('K2_CONSTANT_BAND_10'));

var nightRad = nightMasked.select('B10').multiply(M_L).add(A_L).rename('RAD10');

var nightBT_K = nightRad.expression('K2 / log(K1 / L + 1)',
  {K1: ee.Image.constant(K1), K2: ee.Image.constant(K2), L: nightRad}).rename('BT_K');

var nightBT = nightBT_K.subtract(273.15).rename('BT').clip(analysisExtent);

// Emissivity-corrected night LST.
var epsImg   = emissivityFromWorldCover(worldcover);
var nightLST = lstFromBT(nightBT_K, epsImg).subtract(273.15)
                 .rename('LST').clip(analysisExtent);

// What the correction was worth, per pixel.
var nightCorrection = nightLST.subtract(nightBT).rename('correction');


/* ============================================================
   F)  ZONAL STATISTICS
   ============================================================ */

/* Zonal statistics.

   mean, stdDev, min, max and count are all streaming reducers: Earth
   Engine can accumulate them pixel by pixel without holding the data.
   median is NOT — it needs the full distribution in memory, and over
   a 2800 km2 extent that is what tips the whole computation over.

   median is therefore computed separately and only where it is
   actually reported (the headline table), via zonalStatsFull below.
   Every sensitivity sweep uses the cheap version, which is what the
   ~20 computeUHI calls in sections I-K go through. */
function zonalStats(img, band, mask, geom) {
  return img.select(band).updateMask(mask).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.count(),  sharedInputs: true}),
    geometry: geom, scale: STATS_SCALE_M,
    maxPixels: MAX_PIXELS, bestEffort: true});
}

/* Full statistics including median and min/max, for the three
   headline rows only. */
function zonalStatsFull(img, band, mask, geom) {
  return img.select(band).updateMask(mask).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.median(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.count(),  sharedInputs: true}),
    geometry: geom, scale: STATS_SCALE_M,
    maxPixels: MAX_PIXELS, bestEffort: true});
}

function safeDiff(a, b) {
  return ee.Algorithms.If(ee.Algorithms.IsEqual(a, null), null,
    ee.Algorithms.If(ee.Algorithms.IsEqual(b, null), null,
      ee.Number(a).subtract(ee.Number(b))));
}

/* Cheap version — mean, sd, count. Used by every sensitivity sweep. */
function computeUHI(img, band, rMask, rGeom) {
  rMask = rMask || ruralMask;
  rGeom = rGeom || ruralZone;
  var u = zonalStats(img, band, urbanMask, aoi);
  var r = zonalStats(img, band, rMask, rGeom);
  return ee.Dictionary({
    urban_mean:  u.get(band + '_mean'), urban_sd:    u.get(band + '_stdDev'),
    urban_count: u.get(band + '_count'),
    rural_mean:  r.get(band + '_mean'), rural_sd:    r.get(band + '_stdDev'),
    rural_count: r.get(band + '_count'),
    uhi: safeDiff(u.get(band + '_mean'), r.get(band + '_mean'))
  });
}

/* Full version — adds median and min/max. Used for the three
   headline rows only. */
function computeUHIFull(img, band, rMask, rGeom) {
  rMask = rMask || ruralMask;
  rGeom = rGeom || ruralZone;
  var u = zonalStatsFull(img, band, urbanMask, aoi);
  var r = zonalStatsFull(img, band, rMask, rGeom);
  return ee.Dictionary({
    urban_mean:  u.get(band + '_mean'),   urban_sd:    u.get(band + '_stdDev'),
    urban_median:u.get(band + '_median'), urban_min:   u.get(band + '_min'),
    urban_max:   u.get(band + '_max'),    urban_count: u.get(band + '_count'),
    rural_mean:  r.get(band + '_mean'),   rural_sd:    r.get(band + '_stdDev'),
    rural_median:r.get(band + '_median'), rural_min:   r.get(band + '_min'),
    rural_max:   r.get(band + '_max'),    rural_count: r.get(band + '_count'),
    uhi: safeDiff(u.get(band + '_mean'), r.get(band + '_mean'))
  });
}


/* ============================================================
   G)  SETUP DIAGNOSTICS
   ============================================================ */

/* Zone areas. Computed at 200 m with bestEffort: these are reported
   once for the study-area table and do not need the statistics grid.
   Part B already reports the same areas at 100 m; the two agree to
   within a few km2, which is well inside the precision the report
   quotes. */
var pxArea = ee.Image.pixelArea().divide(1e6);
function areaOf(mask, geom) {
  return pxArea.updateMask(mask).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: geom,
    scale: 200, maxPixels: MAX_PIXELS, bestEffort: true}).get('area');
}

print('================ SETUP ================');
print('AOI area, ellipsoidal (km2):', AOI_AREA_KM2);
print('AOI area, GADM attribute (km2):', aoiFC.first().get('area_km2'));
print('Urban zone (km2):', areaOf(urbanMask, aoi));
print('Rural zone, 5-20 km ring after exclusions (km2):', areaOf(ruralMask, ruralZone));

print('-- Scene metadata --');
print('Day scene:', DAY_SCENE);
print('  cloud cover (%):', dayRaw.get('CLOUD_COVER'));
print('  date:', dayRaw.get('DATE_ACQUIRED'));
print('  sun elevation:', dayRaw.get('SUN_ELEVATION'));
print('Night scene:', NIGHT_SCENE);
print('  cloud cover (%):', nightRaw.get('CLOUD_COVER'));
print('  date:', nightRaw.get('DATE_ACQUIRED'));
print('  sun elevation (negative confirms night):', nightRaw.get('SUN_ELEVATION'));
print('  WRS path/row:', nightRaw.get('WRS_PATH'), nightRaw.get('WRS_ROW'));
print('  RADIANCE_MULT_BAND_10:', M_L);
print('  RADIANCE_ADD_BAND_10:',  A_L);
print('  K1 / K2:', K1, K2);

/* Valid-pixel fraction after QA masking — the brief asks for this.
   Night Fmask is unreliable because it keys off reflective bands
   that carry no signal at night, so the night figure needs
   interpreting rather than trusting. */
print('-- Valid-pixel fraction after QA masking (evaluated at 300 m) --');
print('Day LST, over AOI:',   validFraction(dayLST, aoi, 300));
print('Day LST, over ring:',  validFraction(dayLST, ruralZone, 300));
print('Night BT, over AOI:',  validFraction(nightBT, aoi, 300));
print('Night BT, over ring:', validFraction(nightBT, ruralZone, 300));
print('NOTE: night QA_PIXEL is unreliable — Fmask keys off the');
print('reflective bands, which carry no signal on a night pass.');
print('Interpret the night fraction with care rather than trusting it.');


/* ============================================================
   H)  HEADLINE RESULTS
   ============================================================ */

var dayStats      = computeUHIFull(dayLST,   'LST', ruralMask, ruralZone);
var nightBTStats  = computeUHIFull(nightBT,  'BT',  ruralMask, ruralZone);
var nightLSTStats = computeUHIFull(nightLST, 'LST', ruralMask, ruralZone);

var headline = ee.FeatureCollection([
  ee.Feature(null, dayStats.combine(ee.Dictionary({
    mode: 'Day', variable: 'LST (L2 product)', date: '2015-10-08'}))),
  ee.Feature(null, nightBTStats.combine(ee.Dictionary({
    mode: 'Night', variable: 'Brightness temperature', date: '2015-10-09'}))),
  ee.Feature(null, nightLSTStats.combine(ee.Dictionary({
    mode: 'Night', variable: 'LST (class emissivity)', date: '2015-10-09'})))
]);

print('=========== H) LANDSAT UHI, external 5-20 km rural ring ===========', headline);


/* ============================================================
   I)  SENSITIVITY 1 — RURAL RING SWEEP
   ============================================================
   Same ring variants as Part B, so the two sweeps are directly
   comparable.
   ============================================================ */

var RING_VARIANTS = [
  {inner: 2000,  outer: 20000},
  {inner: 5000,  outer: 20000},   // headline
  {inner: 10000, outer: 25000},
  {inner: 5000,  outer: 30000}
];

var ringRows = [];
RING_VARIANTS.forEach(function (v) {
  var rr  = ruralMaskForRing(v.inner, v.outer);
  var tag = (v.inner / 1000) + '-' + (v.outer / 1000) + ' km';
  ringRows.push(ee.Feature(null, computeUHI(dayLST, 'LST', rr.mask, rr.geom)
    .combine(ee.Dictionary({ring: tag, mode: 'Day', variable: 'LST'}))));
  ringRows.push(ee.Feature(null, computeUHI(nightLST, 'LST', rr.mask, rr.geom)
    .combine(ee.Dictionary({ring: tag, mode: 'Night', variable: 'LST'}))));
});
var ringSweep = ee.FeatureCollection(ringRows);
print('=========== I) RURAL RING SENSITIVITY ===========', ringSweep);


/* ============================================================
   J)  SENSITIVITY 2 — INTERNAL vs EXTERNAL REFERENCE
   ============================================================
   What moving the rural reference outside the city was worth.
   The internal definition is what v1 used.
   ============================================================ */

var refRows = [];
[['Day', dayLST, 'LST'], ['Night', nightLST, 'LST'], ['Night BT', nightBT, 'BT']]
  .forEach(function (m) {
    var ext = computeUHI(m[1], m[2], ruralMask,         ruralZone);
    var int_ = computeUHI(m[1], m[2], ruralMaskInternal, aoi);
    refRows.push(ee.Feature(null, ee.Dictionary({
      mode: m[0],
      uhi_external_ring:   ext.get('uhi'),
      uhi_internal:        int_.get('uhi'),
      rural_mean_external: ext.get('rural_mean'),
      rural_mean_internal: int_.get('rural_mean'),
      difference: safeDiff(ext.get('uhi'), int_.get('uhi'))
    })));
  });
var refTest = ee.FeatureCollection(refRows);
print('=========== J) INTERNAL vs EXTERNAL REFERENCE ===========', refTest);


/* ============================================================
   K)  SENSITIVITY 3 — WATER INCLUSION
   ============================================================ */

var ruralWithWater = (isRuralCover.or(isWater).or(isWetland))
  .and(inRural).selfMask();

var waterRows = [];
[['Day', dayLST, 'LST'], ['Night', nightLST, 'LST']].forEach(function (m) {
  var excl = computeUHI(m[1], m[2], ruralMask,      ruralZone);
  var incl = computeUHI(m[1], m[2], ruralWithWater, ruralZone);
  waterRows.push(ee.Feature(null, ee.Dictionary({
    mode: m[0],
    uhi_water_excluded: excl.get('uhi'),
    uhi_water_included: incl.get('uhi'),
    rural_mean_excluded: excl.get('rural_mean'),
    rural_mean_included: incl.get('rural_mean'),
    difference: safeDiff(incl.get('uhi'), excl.get('uhi'))
  })));
});
var waterTest = ee.FeatureCollection(waterRows);
print('=========== K) WATER INCLUSION TEST ===========', waterTest);


/* ============================================================
   L)  SENSITIVITY 4 — EMISSIVITY CORRECTION
   ============================================================ */

var emisStats = nightCorrection.reduceRegion({
  reducer: ee.Reducer.mean().combine({reducer2: ee.Reducer.minMax(), sharedInputs: true}),
  geometry: analysisExtent, scale: 200,
  maxPixels: MAX_PIXELS, bestEffort: true});

print('=========== L) NIGHT EMISSIVITY CORRECTION ===========');
print('LST minus BT, mean/min/max over extent (K):', emisStats);
print('Night UHI from BT  (no correction):', nightBTStats.get('uhi'));
print('Night UHI from LST (class emissivity):', nightLSTStats.get('uhi'));
print('NOTE: the correction does not cancel in the urban-rural difference,');
print('because built (0.970) and vegetated (0.985) emissivities differ.');


/* ============================================================
   M)  ANOMALY MAPS
   ============================================================
   Computed over the whole extent, NOT masked to urban — the
   point of an anomaly map is to show the urban-rural contrast.
   ============================================================ */

var dayRuralMean   = ee.Number(zonalStats(dayLST, 'LST', ruralMask, ruralZone).get('LST_mean'));
var nightRuralMean = ee.Number(zonalStats(nightLST, 'LST', ruralMask, ruralZone).get('LST_mean'));

var dayAnomaly   = dayLST.subtract(dayRuralMean).rename('day_anomaly');
var nightAnomaly = nightLST.subtract(nightRuralMean).rename('night_anomaly');


/* ============================================================
   N)  MAP LAYERS
   ============================================================ */

Map.centerObject(aoi, 10);
Map.setOptions('HYBRID');

/* Outlines are drawn from the simplified geometry. Painting the
   full-resolution coastline polygon on every map redraw is slow
   enough to trigger client-side timeouts. */
Map.addLayer(ee.FeatureCollection([ee.Feature(ruralZone)])
  .style({color: '00ffff', fillColor: '00000000', width: 2}),
  {}, '1. Rural ring outline', true);
Map.addLayer(aoiFC.style({color: 'ffff00', fillColor: '00000000', width: 2}),
  {}, '2. AOI boundary', true);

Map.addLayer(urbanMask, {palette: ['e31a1c']}, '3. Urban zone', false);
Map.addLayer(ruralMask, {palette: ['33a02c']}, '4. Rural zone', false);
Map.addLayer(ruralMaskInternal, {palette: ['ff7f00']},
  '5. Rural zone, v1 internal definition', false);

Map.addLayer(dayLST,   VIS_LST, '6. Day LST (8 Oct 2015)', true);
Map.addLayer(nightBT,  VIS_BT,  '7. Night BT (9 Oct 2015)', false);
Map.addLayer(nightLST, VIS_BT,  '8. Night LST, emissivity corrected', false);

Map.addLayer(dayAnomaly,   VIS_ANOM, '9. Day anomaly vs rural mean', false);
Map.addLayer(nightAnomaly, VIS_ANOM, '10. Night anomaly vs rural mean', false);
Map.addLayer(epsImg, {min: 0.95, max: 0.99}, '11. Emissivity', false);

var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 10px'}});
legend.add(ui.Label('Zones', {fontWeight: 'bold', fontSize: '13px'}));
[['e31a1c', 'Urban (built-up, in district)'],
 ['33a02c', 'Rural (veg/bare, 5-20 km ring)'],
 ['ff7f00', 'Rural, v1 internal definition'],
 ['ffff00', 'District boundary'],
 ['00ffff', 'Rural ring edge']].forEach(function (r) {
  legend.add(ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    widgets: [ui.Label('', {backgroundColor: '#' + r[0], padding: '8px',
                            margin: '0 8px 3px 0'}),
              ui.Label(r[1], {fontSize: '11px', margin: '2px 0 0 0'})]}));
});
Map.add(legend);


/* ============================================================
   O)  CHARTS
   ============================================================ */

// Urban vs rural distribution, one chart each for day and night.
print(ui.Chart.image.histogram({
  image: dayLST.updateMask(urbanMask).rename('Urban')
           .addBands(dayLST.updateMask(ruralMask).rename('Rural')),
  region: analysisExtent, scale: HIST_SCALE_M,
  maxPixels: MAX_PIXELS, minBucketWidth: 0.25
}).setSeriesNames(['Urban', 'Rural']).setOptions({
  title: 'Daytime LST distribution, urban vs rural (8 Oct 2015)',
  hAxis: {title: 'LST (deg C)'}, vAxis: {title: 'Pixel count'},
  colors: ['b2182b', '2a9d8f']}));

print(ui.Chart.image.histogram({
  image: nightLST.updateMask(urbanMask).rename('Urban')
           .addBands(nightLST.updateMask(ruralMask).rename('Rural')),
  region: analysisExtent, scale: HIST_SCALE_M,
  maxPixels: MAX_PIXELS, minBucketWidth: 0.25
}).setSeriesNames(['Urban', 'Rural']).setOptions({
  title: 'Night-time LST distribution, urban vs rural (9 Oct 2015)',
  hAxis: {title: 'LST (deg C)'}, vAxis: {title: 'Pixel count'},
  colors: ['b2182b', '2a9d8f']}));

print(ui.Chart.feature.groups({
  features: ringSweep, xProperty: 'ring', yProperty: 'uhi', seriesProperty: 'mode'
}).setChartType('ColumnChart').setOptions({
  title: 'Landsat UHI sensitivity to rural ring definition',
  vAxis: {title: 'UHI intensity (deg C)'},
  hAxis: {title: 'Ring (km from boundary)'}}));

// Mean LST by WorldCover class — shows what drives the urban mean.
var WC_NAMES = ee.Dictionary({
  '10': 'Tree cover', '20': 'Shrubland', '30': 'Grassland', '40': 'Cropland',
  '50': 'Built-up', '60': 'Bare/sparse', '80': 'Water',
  '90': 'Wetland', '95': 'Mangroves', '100': 'Moss/lichen'});

/* Grouped reducer over eleven classes across the whole extent is the
   single most expensive call in the script, so it runs at 200 m with
   bestEffort. Class means are robust to scale; the ranking between
   classes is what matters here. */
var grouped = dayLST.addBands(worldcover).reduceRegion({
  reducer: ee.Reducer.mean().group({groupField: 1, groupName: 'class'}),
  geometry: analysisExtent, scale: 200,
  maxPixels: MAX_PIXELS, bestEffort: true});

var byClass = ee.FeatureCollection(ee.List(grouped.get('groups')).map(function (g) {
  g = ee.Dictionary(g);
  var cls = ee.Number(g.get('class')).toInt();
  return ee.Feature(null, {
    class_id: cls,
    class_name: WC_NAMES.get(cls.format('%d'), ee.String('Class ').cat(cls.format('%d'))),
    day_LST_mean: g.get('mean')});
}));
print('Mean daytime LST by WorldCover class:', byClass);


/* ============================================================
   P)  EXPORTS
   ============================================================ */

Export.table.toDrive({
  collection: headline, description: 'Mumbai_Landsat_UHI_headline_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['mode', 'variable', 'date', 'urban_mean', 'urban_sd', 'urban_median',
              'urban_min', 'urban_max', 'urban_count', 'rural_mean', 'rural_sd',
              'rural_median', 'rural_min', 'rural_max', 'rural_count', 'uhi']});

Export.table.toDrive({
  collection: ringSweep, description: 'Mumbai_Landsat_RuralRing_Sensitivity_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['mode', 'variable', 'ring', 'urban_mean', 'rural_mean', 'uhi',
              'urban_count', 'rural_count']});

Export.table.toDrive({
  collection: refTest, description: 'Mumbai_Landsat_ReferenceDefinition_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['mode', 'uhi_external_ring', 'uhi_internal',
              'rural_mean_external', 'rural_mean_internal', 'difference']});

Export.table.toDrive({
  collection: waterTest, description: 'Mumbai_Landsat_WaterExclusion_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['mode', 'uhi_water_excluded', 'uhi_water_included',
              'rural_mean_excluded', 'rural_mean_included', 'difference']});

Export.table.toDrive({
  collection: byClass, description: 'Mumbai_Landsat_LST_by_class_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['class_id', 'class_name', 'day_LST_mean']});

// Pixel values for distribution plots, matching Part B's export.
var dayDist = dayLST.updateMask(urbanMask).rename('T')
    .sample({region: aoi, scale: SAMPLE_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Urban', 'mode', 'Day'); })
  .merge(dayLST.updateMask(ruralMask).rename('T')
    .sample({region: ruralZone, scale: SAMPLE_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Rural', 'mode', 'Day'); }));

var nightDist = nightLST.updateMask(urbanMask).rename('T')
    .sample({region: aoi, scale: SAMPLE_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Urban', 'mode', 'Night'); })
  .merge(nightLST.updateMask(ruralMask).rename('T')
    .sample({region: ruralZone, scale: SAMPLE_SCALE_M, geometries: false})
    .map(function (f) { return f.set('zone', 'Rural', 'mode', 'Night'); }));

Export.table.toDrive({
  collection: dayDist.merge(nightDist),
  description: 'Mumbai_Landsat_Distribution_PixelValues_v2',
  folder: 'Mumbai_UHI_Landsat', fileFormat: 'CSV',
  selectors: ['mode', 'zone', 'T']});

/* Rasters at full 30 m Landsat resolution. Exports run on Earth
   Engine's batch system rather than interactively, so they are not
   subject to the interactive memory limit that the reducers above
   are — 30 m is fine here even though it is not fine for
   reduceRegion. Each covers the district plus the 20 km buffer. */
[['Mumbai_Landsat_Day_LST_v2', dayLST],
 ['Mumbai_Landsat_Night_BT_v2', nightBT],
 ['Mumbai_Landsat_Night_LST_v2', nightLST],
 ['Mumbai_Landsat_Day_Anomaly_v2', dayAnomaly],
 ['Mumbai_Landsat_Night_Anomaly_v2', nightAnomaly]
].forEach(function (e) {
  Export.image.toDrive({
    image: e[1], description: e[0], folder: 'Mumbai_UHI_Landsat',
    region: analysisExtent, scale: 30, maxPixels: 1e13});
});
