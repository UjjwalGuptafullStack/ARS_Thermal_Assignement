/************************************************************
Urban Heat Island (UHI) — Landsat-only Tutorial  ·  v3
============================================================
City : New Delhi (centre + 50 km)
Modes: DAY  = Landsat 8 Collection-2 Level-2 (ST_B10)
       NIGHT= Landsat 8 Collection-2 Level-1 (B10 -> radiance -> BT -> LST)
Author : Megha Negi
Version: v3
************************************************************/


// /* ============================================================
//   0)  PARAMETERS
//   ============================================================ */

// var CITY_CENTER = ee.Geometry.Point([77.2090, 28.6139]);   // (lon, lat)
// var BUFFER_KM   = 50;
// var AOI         = CITY_CENTER.buffer(BUFFER_KM * 1000).bounds();

// // ---- NIGHT (Level-1), exact scene ----------------------------------------
// // Delhi has no routine night imaging. The 2015-09-04 -> 2015-11-14 window was
// // a special-request campaign. This is the night scene with the closest
// // low-cloud daytime companion (3-day gap).
// //
// // NOTE: row 204 is not a typo. WRS-2 rows above 122 are ASCENDING
// // (night) passes. The same ground location has a different path/row by night
// // than by day - which is exactly why you cannot reuse the daytime path/row.
// var NIGHT_PATH = 14;
// var NIGHT_ROW  = 204;
// var NIGHT_DATE = '2015-10-13';

// // ---- DAY (Level-2) search windows ----------------------------------------
// // Window A brackets 2015-10-10 (0% cloud, ~82% valid ST) - the closest clear
// // daytime scene to NIGHT_DATE. Window B is the seasonal comparison.
// var DAY_A_START_DEFAULT = '2015-10-08';
// var DAY_A_END_DEFAULT   = '2015-10-12';
// var DAY_B_START_DEFAULT = '2015-01-01';
// var DAY_B_END_DEFAULT   = '2015-02-25';

// var DAY_MIN_SUNEL = 20;    // sun elevation floor -> guarantees daytime
// var DAY_MIN_VALID = 0.4;   // require >= 40% valid ST pixels over the AOI

// // ---- Landsat 8 band-10 Planck constants ----------------------------------
// // Present as image properties on Level-1. Level-2 does not carry them, so we
// // hard-code them for the ST_TRAD path only.
// var K1_B10 = 774.8853;
// var K2_B10 = 1321.0789;

// // ---- Collection-2 scale factors ------------------------------------------
// var SF = {
//   sr_mult: 0.0000275, sr_add: -0.2,     // SR_B*
//   st_mult: 0.00341802, st_add: 149.0,   // ST_B10  -> Kelvin
//   trad:    0.001,                       // ST_TRAD -> W/(m^2 sr um)
//   emis:    0.0001                       // ST_EMIS -> unitless
// };

// // ---- Class-based emissivity (night) --------------------------------------
// var EMIS_MAP = {
//   built: 0.970,   // WorldCover 50
//   veg:   0.985,   // trees / grass / crop / wetland
//   bare:  0.960,   // bare / sparse
//   water: 0.990
// };

// // ---- Visualisation & processing scales -----------------------------------
// var LST_VIS  = {min: 15, max: 40,
//   palette: ['040274', '2166ac', '67a9cf', 'd1e5f0', 'fddbc7', 'ef8a62', 'b2182b']};
// var ANOM_VIS = {min: -2, max: 6, palette: ['1a9850', 'fee08b', 'f46d43', 'a50026']};

// var URBAN_COLOR = 'ff0000', RURAL_COLOR = '00ff5e';

// var URBAN_ERODE_DEFAULT = 500;    // metres
// var RURAL_ERODE_DEFAULT = 2000;   // metres

// var STATS_SCALE_M  = 60;    // reduceRegion scale for all statistics
// var SAMPLE_SCALE_M = 90;    // histogram / sampling scale

// // [FIX 5] discards stale async callbacks from superseded renders
// var renderToken = 0;

// // [FIX 9] remembers the last UHI value computed in each mode
// var lastDayUHI = null, lastNightUHI = null;


// /* ============================================================
//   1)  UI PANEL
//   ============================================================ */

// var panel = ui.Panel({style: {position: 'top-left', padding: '8px', width: '400px'}});
// panel.add(ui.Label('UHI — New Delhi  ·  Landsat Day (L2) vs Night (L1)',
//   {fontWeight: 'bold', fontSize: '16px'}));
// panel.add(ui.Label('Set the controls, then press APPLY.', {color: 'gray', fontSize: '11px'}));

// var modeSelect = ui.Select({
//   items: ['DAY (L2 ST_B10)', 'NIGHT (L1 BT/LST)'],
//   value: 'NIGHT (L1 BT/LST)',
//   style: {width: '100%'},
//   onChange: render          // mode is a cheap, deliberate switch - render now
// });
// panel.add(modeSelect);

// var useEmissivityNight = ui.Checkbox({
//   label: 'Night: apply class-based emissivity (BT → LST)',
//   value: true, onChange: render
// });
// panel.add(useEmissivityNight);

// var useNDVIEmissivityDay = ui.Checkbox({
//   label: 'Day: rebuild LST from ST_TRAD + NDVI emissivity',
//   value: false, onChange: render
// });
// panel.add(useNDVIEmissivityDay);

// // ---- core-mask sensitivity ------------------------------------------------
// panel.add(ui.Label('— Core mask sensitivity —', {fontWeight: 'bold', margin: '10px 0 2px 0'}));

// var urbanErodeLabel = ui.Label('Urban core erosion: ' + URBAN_ERODE_DEFAULT + ' m');
// panel.add(urbanErodeLabel);
// var urbanErodeSlider = ui.Slider({
//   min: 100, max: 3000, value: URBAN_ERODE_DEFAULT, step: 100, style: {width: '100%'},
//   // [FIX 8] label only - no render until APPLY
//   onChange: function (v) { urbanErodeLabel.setValue('Urban core erosion: ' + v + ' m'); }
// });
// panel.add(urbanErodeSlider);

// var ruralErodeLabel = ui.Label('Rural core erosion: ' + RURAL_ERODE_DEFAULT + ' m');
// panel.add(ruralErodeLabel);
// var ruralErodeSlider = ui.Slider({
//   min: 100, max: 3000, value: RURAL_ERODE_DEFAULT, step: 100, style: {width: '100%'},
//   onChange: function (v) { ruralErodeLabel.setValue('Rural core erosion: ' + v + ' m'); }
// });
// panel.add(ruralErodeSlider);

// panel.add(ui.Button({
//   label: 'APPLY  ▸  recompute',
//   style: {stretch: 'horizontal'},
//   onClick: render
// }));

// // ---- seasonal comparison --------------------------------------------------
// panel.add(ui.Label('— Seasonal comparison (DAY mode) —', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
// panel.add(ui.Label('YYYY-MM-DD. Window A also drives the DAY render.',
//   {color: 'gray', fontSize: '11px'}));

// var winAStart = ui.Textbox({value: DAY_A_START_DEFAULT, style: {width: '95px'}});
// var winAEnd   = ui.Textbox({value: DAY_A_END_DEFAULT,   style: {width: '95px'}});
// var winBStart = ui.Textbox({value: DAY_B_START_DEFAULT, style: {width: '95px'}});
// var winBEnd   = ui.Textbox({value: DAY_B_END_DEFAULT,   style: {width: '95px'}});

// panel.add(ui.Label('Window A:'));
// panel.add(ui.Panel({layout: ui.Panel.Layout.Flow('horizontal'), widgets: [winAStart, winAEnd]}));
// panel.add(ui.Label('Window B:'));
// panel.add(ui.Panel({layout: ui.Panel.Layout.Flow('horizontal'), widgets: [winBStart, winBEnd]}));
// panel.add(ui.Button({label: 'Compare A vs B', onClick: runSeasonalComparison}));
// var seasonalLabel = ui.Label('', {fontSize: '11px', color: 'gray'});
// panel.add(seasonalLabel);

// // ---- results readouts -----------------------------------------------------
// panel.add(ui.Label('— Results —', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
// var statusLabel      = ui.Label('Ready.', {fontSize: '11px', color: 'gray'});
// var uhiLabel         = ui.Label('UHI: —', {fontWeight: 'bold', fontSize: '14px', color: 'b2182b'});
// // [FIX 9] both modes visible at once
// var bothModesLabel   = ui.Label('Day UHI: —   |   Night UHI: —', {fontSize: '12px', color: '333333'});
// var coreCountLabel   = ui.Label('Stats pixels — Urban: — | Rural: —', {fontSize: '11px', color: 'gray'});
// var validFracLabel   = ui.Label('Valid ST/BT fraction over AOI: —', {fontSize: '11px', color: 'gray'});
// var anomLabel        = ui.Label('Anomaly p2–p98: —', {fontSize: '11px', color: 'gray'});
// [statusLabel, uhiLabel, bothModesLabel, coreCountLabel, validFracLabel, anomLabel]
//   .forEach(function (w) { panel.add(w); });

// ui.root.add(panel);

// // [FIX 6] charts live here and are wiped on every render
// var chartPanel = ui.Panel({
//   style: {position: 'bottom-right', width: '460px', maxHeight: '520px', padding: '4px'}
// });

// function status(msg) { statusLabel.setValue(msg); }

// function refreshBothModes() {
//   bothModesLabel.setValue(
//     'Day UHI: '   + (lastDayUHI   === null ? '—' : lastDayUHI.toFixed(2)   + ' °C') +
//     '   |   Night UHI: ' + (lastNightUHI === null ? '—' : lastNightUHI.toFixed(2) + ' °C'));
// }


// /* ============================================================
//   2)  HELPERS
//   ============================================================ */

// function addLegend(title, palette, labels) {
//   var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
//   legend.add(ui.Label(title, {fontWeight: 'bold'}));
//   for (var i = 0; i < palette.length; i++) {
//     legend.add(ui.Panel({
//       layout: ui.Panel.Layout.Flow('horizontal'),
//       widgets: [
//         ui.Label('', {backgroundColor: '#' + palette[i].replace('#', ''),
//                       padding: '8px', margin: '0 8px 4px 0'}),
//         ui.Label(labels[i] !== undefined ? labels[i] + ' °C' : '')
//       ]
//     }));
//   }
//   Map.add(legend);
// }

// function erodeMask(binImg, radiusMeters) {
//   return binImg.focal_min({radius: radiusMeters, units: 'meters'});
// }

// /* [FIX 1] ------------------------------------------------------------------
//   Collection-2 QA_PIXEL bit assignments:
//     bit 0  Fill
//     bit 1  Dilated cloud
//     bit 2  Cirrus
//     bit 3  Cloud
//     bit 4  Cloud shadow
//     bit 5  Snow
//     bit 6  Clear          <- do NOT mask
//     bit 7  Water          <- do NOT mask (we handle water via WorldCover)
//   Masking bits 0-5 in one go. Identical for Level-1 and Level-2, so one
//   function replaces the two near-duplicates in v1/v2.
// --------------------------------------------------------------------------- */
// function maskQA(image) {
//   var bad = image.select('QA_PIXEL').bitwiseAnd(parseInt('111111', 2)).neq(0);
//   return image.updateMask(bad.not());
// }

// function applyScaleL2(image) {
//   var optical  = image.select('SR_B.*').multiply(SF.sr_mult).add(SF.sr_add);
//   var thermalK = image.select('ST_B.*').multiply(SF.st_mult).add(SF.st_add);  // Kelvin
//   return image.addBands(optical, null, true).addBands(thermalK, null, true);
// }

// function K_to_C(imgK) { return imgK.subtract(273.15).rename('LST_C'); }

// // Fraction of AOI pixels that survived masking (0-1).
// function validFraction(imgBand, region, scale) {
//   var d = imgBand.mask().reduceRegion({
//     reducer: ee.Reducer.mean(), geometry: region,
//     scale: scale, maxPixels: 1e10, bestEffort: true
//   });
//   var v = ee.Algorithms.If(d.size().gt(0), ee.Number(d.values().get(0)), 0);
//   return ee.Number(ee.Algorithms.If(v, v, 0));
// }

// // Planck inversion: spectral radiance -> brightness temperature (Kelvin).
// function radianceToBT(radImg, K1, K2) {
//   return radImg.expression('K2 / log(K1 / L + 1)',
//     {K1: K1, K2: K2, L: radImg}).rename('BT_K');
// }

// // Single-channel emissivity correction, BT (K) -> LST (K).
// //   LST = BT / [ 1 + (lambda * BT / c2) * ln(eps) ]
// function lstFromBTandEmissivity(btK, emissivity) {
//   var lambda = ee.Image.constant(10.895e-6);   // band-10 centre wavelength, m
//   var c2     = ee.Image.constant(1.4388e-2);   // second radiation constant, m*K
//   var term   = lambda.multiply(btK).divide(c2).multiply(emissivity.log());
//   return btK.divide(ee.Image(1).add(term));
// }

// // NDVI threshold method (Sobrino) for emissivity.
// function emissivityFromNDVI(ndvi) {
//   var NDVI_SOIL = 0.2, NDVI_VEG = 0.5;
//   var EPS_VEG = 0.985, EPS_SOIL = 0.960, C = 0.005;
//   var Pv = ndvi.subtract(NDVI_SOIL).divide(NDVI_VEG - NDVI_SOIL).clamp(0, 1).pow(2);
//   return Pv.multiply(EPS_VEG)
//     .add(ee.Image(1).subtract(Pv).multiply(EPS_SOIL))
//     .add(C)
//     .rename('Emissivity_NDVI');
// }

// // Class-based emissivity from WorldCover.
// function emissivityFromWorldCover(wcImage) {
//   var built = wcImage.eq(50).multiply(EMIS_MAP.built);
//   var water = wcImage.eq(80).multiply(EMIS_MAP.water);
//   var veg   = wcImage.eq(10).or(wcImage.eq(30)).or(wcImage.eq(40))
//                 .or(wcImage.eq(90)).or(wcImage.eq(95)).multiply(EMIS_MAP.veg);
//   var bare  = wcImage.eq(60).multiply(EMIS_MAP.bare);
//   var other = wcImage.neq(50).and(wcImage.neq(80)).and(wcImage.neq(10))
//                 .and(wcImage.neq(30)).and(wcImage.neq(40)).and(wcImage.neq(60))
//                 .and(wcImage.neq(90)).and(wcImage.neq(95)).multiply(EMIS_MAP.veg);
//   var eps = built.add(water).add(veg).add(bare).add(other).rename('Emissivity');
//   return eps.updateMask(eps.neq(0));
// }


// /* ============================================================
//   3)  BASE MASKS
//   ============================================================ */

// var wc      = ee.Image('ESA/WorldCover/v200/2021').select('Map').clip(AOI);
// var isUrban = wc.eq(50);
// var isWater = wc.eq(80);
// var isRural = isUrban.not().and(isWater.not());


// /* ============================================================
//   4)  DAY BRANCH  (Level-2)
//   ============================================================ */

// var L2_DAY = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
//   .merge(ee.ImageCollection('LANDSAT/LC08/C02/T2_L2'));

// // Returns the candidate collection, sorted best-first. Caller checks .size().
// function dayCandidates(aoi, start, end, sunMin, minValid) {
//   return L2_DAY
//     .filterBounds(aoi)
//     .filterDate(start, end)
//     .filter(ee.Filter.gt('SUN_ELEVATION', sunMin))
//     .map(maskQA)
//     .map(applyScaleL2)
//     .map(function (img) {
//       var lstC = K_to_C(img.select('ST_B10')).rename('LST_C');
//       return img.set('validFrac', validFraction(lstC, aoi, 60));
//     })
//     .filter(ee.Filter.gte('validFrac', minValid))
//     .sort('validFrac', false);
// }

// /* Builds the day LST image for a window.
//   useNDVI = false -> ST_B10, the product's own surface temperature.
//   useNDVI = true  -> [FIX 2] ST_TRAD * 0.001 -> Planck -> BT -> NDVI epsilon.
//                       ST_TRAD is RADIANCE, not Kelvin. v2 used it raw. */
// function getDayLST(aoi, start, end, sunMin, minValid, useNDVI) {
//   var col      = dayCandidates(aoi, start, end, sunMin, minValid);
//   var best     = ee.Image(col.first());
//   var bestDate = ee.Date(best.get('DATE_ACQUIRED'));

//   // Mosaic every scene acquired that day, so a partial tile does not clip the AOI.
//   var sameDay = L2_DAY
//     .filterBounds(aoi)
//     .filterDate(bestDate, bestDate.advance(1, 'day'))
//     .filter(ee.Filter.gt('SUN_ELEVATION', sunMin))
//     .map(maskQA)
//     .map(applyScaleL2);

//   var L2 = ee.Image(sameDay.mosaic()).clip(aoi);

//   var LST_C, tag, epsNDVI = null, epsProduct = null;

//   if (!useNDVI) {
//     LST_C = K_to_C(L2.select('ST_B10')).rename('LST_C');
//     tag   = 'DAY — L2 ST_B10 (product LST)';
//   } else {
//     var RED  = L2.select('SR_B4');
//     var NIR  = L2.select('SR_B5');
//     var ndvi = NIR.subtract(RED).divide(NIR.add(RED)).rename('NDVI');

//     epsNDVI = emissivityFromNDVI(ndvi);

//     // [FIX 2] scale ST_TRAD, then invert Planck to get brightness temperature.
//     var trad = L2.select('ST_TRAD').multiply(SF.trad);          // W/(m^2 sr um)
//     var BT_K = radianceToBT(trad, K1_B10, K2_B10);              // Kelvin

//     LST_C = lstFromBTandEmissivity(BT_K, epsNDVI)
//               .subtract(273.15).rename('LST_C');
//     tag   = 'DAY — ST_TRAD → BT + NDVI ε';

//     // [NEW] the emissivity the USGS algorithm actually used, for comparison.
//     epsProduct = L2.select('ST_EMIS').multiply(SF.emis).rename('Emissivity_product');
//   }

//   return {LST_C: LST_C, tag: tag, date: bestDate, col: col,
//           epsNDVI: epsNDVI, epsProduct: epsProduct};
// }


// /* ============================================================
//   5)  NIGHT BRANCH  (Level-1)
//   ============================================================ */

// var L1_ALL = ee.ImageCollection('LANDSAT/LC08/C02/T1')
//   .merge(ee.ImageCollection('LANDSAT/LC08/C02/T2'));

// function nightCandidates(path, row, dateStr) {
//   var start = ee.Date(dateStr);
//   return L1_ALL
//     .filter(ee.Filter.eq('WRS_PATH', path))
//     .filter(ee.Filter.eq('WRS_ROW', row))
//     .filterDate(start, start.advance(1, 'day'));
// }

// // DN -> spectral radiance, using the image's own metadata (never hard-coded).
// function dnToRadianceB10(imgL1) {
//   var M = ee.Number(imgL1.get('RADIANCE_MULT_BAND_10'));
//   var A = ee.Number(imgL1.get('RADIANCE_ADD_BAND_10'));
//   return imgL1.select('B10').multiply(M).add(A).rename('RAD10');
// }


// /* ============================================================
//   6)  RENDER
//   ============================================================ */

// function currentCores() {
//   return {
//     urbanM: urbanErodeSlider.getValue(),
//     ruralM: ruralErodeSlider.getValue(),
//     urban:  erodeMask(isUrban, urbanErodeSlider.getValue()),
//     rural:  erodeMask(isRural, ruralErodeSlider.getValue())
//   };
// }

// function render() {
//   var myToken = ++renderToken;          // [FIX 5]
//   status('Computing…');
//   chartPanel.clear();                   // [FIX 6]

//   Map.clear();
//   Map.add(chartPanel);
//   Map.centerObject(AOI, 9);
//   Map.addLayer(AOI, {color: 'yellow'}, 'AOI (Delhi + 50 km)', false);
//   Map.addLayer(isUrban.selfMask().visualize({palette: [URBAN_COLOR]}), {}, 'Urban (WorldCover)', false);
//   Map.addLayer(isRural.selfMask().visualize({palette: [RURAL_COLOR]}), {}, 'Rural (non-urban, non-water)', false);

//   var cores = currentCores();
//   Map.addLayer(cores.urban.selfMask().visualize({palette: ['990000']}), {},
//     'Urban CORE (−' + cores.urbanM + ' m)', false);
//   Map.addLayer(cores.rural.selfMask().visualize({palette: ['00994a']}), {},
//     'Rural CORE (−' + cores.ruralM + ' m)', false);

//   if (modeSelect.getValue().indexOf('DAY') === 0) {
//     renderDay(myToken, cores);
//   } else {
//     renderNight(myToken, cores);
//   }
// }

// function renderDay(myToken, cores) {
//   var useNDVI = useNDVIEmissivityDay.getValue();
//   var start   = winAStart.getValue(), end = winAEnd.getValue();
//   var col     = dayCandidates(AOI, start, end, DAY_MIN_SUNEL, DAY_MIN_VALID);

//   // [FIX 4] guard before touching .first()
//   col.size().evaluate(function (n, err) {
//     if (myToken !== renderToken) { return; }
//     if (err)  { status('Server error — see console.'); print('Day search error:', err); return; }
//     if (!n)   {
//       status('No daytime L2 scene in ' + start + ' → ' + end +
//             ' passing SUN_ELEVATION > ' + DAY_MIN_SUNEL +
//             ' and validFrac ≥ ' + DAY_MIN_VALID + '. Widen the window or lower DAY_MIN_VALID.');
//       return;
//     }

//     var res = getDayLST(AOI, start, end, DAY_MIN_SUNEL, DAY_MIN_VALID, useNDVI);

//     Map.addLayer(res.LST_C, LST_VIS, res.tag);
//     addLegend('LST (°C)', LST_VIS.palette, [15, 20, 25, 30, 35, 40]);

//     // [NEW] your emissivity vs the product's own
//     if (useNDVI && res.epsProduct) {
//       Map.addLayer(res.epsNDVI,    {min: 0.955, max: 0.995}, 'ε — NDVI method (yours)', false);
//       Map.addLayer(res.epsProduct, {min: 0.955, max: 0.995}, 'ε — ST_EMIS (USGS)',      false);
//       var epsDiff = res.epsNDVI.subtract(res.epsProduct).rename('eps_diff');
//       Map.addLayer(epsDiff, {min: -0.02, max: 0.02,
//         palette: ['2166ac', 'f7f7f7', 'b2182b']}, 'ε difference (yours − USGS)', false);
//       epsDiff.reduceRegion({
//         reducer: ee.Reducer.mean().combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true}),
//         geometry: AOI, scale: STATS_SCALE_M, maxPixels: 1e10
//       }).evaluate(function (d) {
//         if (myToken !== renderToken || !d) { return; }
//         print('ε (NDVI) − ε (ST_EMIS): mean ' + d.eps_diff_mean.toFixed(4) +
//               ', sd ' + d.eps_diff_stdDev.toFixed(4));
//       });
//     }

//     validFraction(res.LST_C, AOI, STATS_SCALE_M).evaluate(function (v) {
//       if (myToken !== renderToken) { return; }
//       validFracLabel.setValue('Valid ST fraction over AOI: ' +
//         (v === null ? '—' : (v * 100).toFixed(1) + ' %'));
//     });

//     res.date.format('YYYY-MM-dd').evaluate(function (dstr) {
//       if (myToken !== renderToken) { return; }
//       status('Day scene: ' + dstr);
//     });

//     summarizeAndCharts(res.LST_C, res.tag, cores, myToken, 'DAY');
//   });
// }

// function renderNight(myToken, cores) {
//   var col = nightCandidates(NIGHT_PATH, NIGHT_ROW, NIGHT_DATE);

//   col.size().evaluate(function (n, err) {          // [FIX 4]
//     if (myToken !== renderToken) { return; }
//     if (err) { status('Server error — see console.'); print('Night search error:', err); return; }
//     if (!n)  {
//       status('No Level-1 scene for path ' + NIGHT_PATH + ' / row ' + NIGHT_ROW +
//             ' on ' + NIGHT_DATE + '. Check the path/row — night passes are ASCENDING (row > 122).');
//       return;
//     }

//     var raw    = ee.Image(col.first());
//     var masked = maskQA(raw);
//     var BT_K   = radianceToBT(dnToRadianceB10(masked),
//                   ee.Number(raw.get('K1_CONSTANT_BAND_10')),
//                   ee.Number(raw.get('K2_CONSTANT_BAND_10')));

//     var img, tag;
//     if (useEmissivityNight.getValue()) {
//       img = lstFromBTandEmissivity(BT_K, emissivityFromWorldCover(wc))
//               .subtract(273.15).rename('LST_C').clip(AOI);
//       tag = 'NIGHT — LST (L1 BT + class ε)';
//     } else {
//       img = BT_K.subtract(273.15).rename('LST_C').clip(AOI);
//       tag = 'NIGHT — Brightness Temperature (ε ≈ 1)';
//     }

//     Map.addLayer(img, LST_VIS, tag);
//     addLegend(useEmissivityNight.getValue() ? 'LST (°C)' : 'BT (°C)',
//       LST_VIS.palette, [15, 20, 25, 30, 35, 40]);

//     /* [FIX 3] Night cloud screening is unreliable: Fmask keys off the
//       reflective bands, which are dark or absent on a TIRS night pass.
//       Show the valid fraction so the class can judge it rather than
//       trusting the mask blindly. */
//     validFraction(img, AOI, STATS_SCALE_M).evaluate(function (v) {
//       if (myToken !== renderToken) { return; }
//       var pct = (v === null ? 0 : v * 100);
//       validFracLabel.setValue('Valid BT fraction over AOI: ' + pct.toFixed(1) +
//         ' %  (night QA_PIXEL is unreliable — interpret with care)');
//       if (pct < 20) {
//         print('WARNING: only ' + pct.toFixed(1) + '% of the night AOI survived masking. ' +
//               'Night Fmask output is often mostly fill. Consider skipping the QA mask ' +
//               'for night scenes and screening visually instead.');
//       }
//     });

//     status('Night scene: ' + NIGHT_DATE + '  (path ' + NIGHT_PATH + ' / row ' + NIGHT_ROW + ')');
//     summarizeAndCharts(img, tag, cores, myToken, 'NIGHT');
//   });
// }


// /* ============================================================
//   7)  STATISTICS, ANOMALY & CHARTS
//   ============================================================ */

// function summarizeAndCharts(LST_C, tag, cores, myToken, modeKey) {

//   var reducers = ee.Reducer.mean()
//     .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
//     .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true})
//     .combine({reducer2: ee.Reducer.count(),  sharedInputs: true});

//   // NOTE: no bestEffort here. If this ever exceeds maxPixels you want the
//   // error, not a silently coarsened scale that contradicts STATS_SCALE_M.
//   var urbanStats = LST_C.updateMask(cores.urban).reduceRegion({
//     reducer: reducers, geometry: AOI, scale: STATS_SCALE_M, maxPixels: 1e10});
//   var ruralStats = LST_C.updateMask(cores.rural).reduceRegion({
//     reducer: reducers, geometry: AOI, scale: STATS_SCALE_M, maxPixels: 1e10});

//   var muU = ee.Number(urbanStats.get('LST_C_mean'));
//   var muR = ee.Number(ruralStats.get('LST_C_mean'));
//   var UHI = muU.subtract(muR);

//   print(tag + ' — Urban CORE stats (°C):', urbanStats);
//   print(tag + ' — Rural CORE stats (°C):', ruralStats);

//   // ---- headline number, in the panel ----
//   ee.Dictionary({
//     uhi: UHI, u: muU, r: muR,
//     cu: urbanStats.get('LST_C_count'), cr: ruralStats.get('LST_C_count')
//   }).evaluate(function (d, err) {
//     if (myToken !== renderToken) { return; }
//     if (err || !d || d.uhi === null) {
//       uhiLabel.setValue('UHI: N/A — no valid pixels. Reduce the erosion radii.');
//       if (err) { print('UHI eval error:', err); }
//       return;
//     }
//     uhiLabel.setValue('UHI = ' + d.uhi.toFixed(2) + ' °C   (Urban ' + d.u.toFixed(2) +
//       ' − Rural ' + d.r.toFixed(2) + ')');
//     coreCountLabel.setValue('Stats pixels @' + STATS_SCALE_M + ' m — Urban: ' + d.cu +
//       ' | Rural: ' + d.cr);

//     if (modeKey === 'DAY') { lastDayUHI = d.uhi; } else { lastNightUHI = d.uhi; }
//     refreshBothModes();                                        // [FIX 9]
//     print(tag + ' — UHI intensity (°C):', d.uhi);
//   });

//   // ---- anomaly layer ----
//   var anomaly = LST_C.subtract(muR).rename('UHI_Anomaly_C');
//   Map.addLayer(anomaly, ANOM_VIS, tag + ' — anomaly vs rural mean');

//   // [FIX 7] percentiles, not min/max: min/max were single cloud-edge pixels.
//   anomaly.reduceRegion({
//     reducer: ee.Reducer.percentile([2, 98]),
//     geometry: AOI, scale: STATS_SCALE_M, maxPixels: 1e10
//   }).evaluate(function (d, err) {
//     if (myToken !== renderToken || err || !d) { return; }
//     var lo = d['UHI_Anomaly_C_p2'], hi = d['UHI_Anomaly_C_p98'];
//     anomLabel.setValue(lo === null ? 'Anomaly p2–p98: —'
//       : 'Anomaly p2–p98: ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' °C');
//   });

//   // ---- mean comparison chart ----
//   var means = ee.FeatureCollection([
//     ee.Feature(null, {zone: 'Urban CORE', mean: muU}),
//     ee.Feature(null, {zone: 'Rural CORE', mean: muR})
//   ]);
//   var meanChart = ui.Chart.feature.byFeature(means, 'zone', ['mean'])
//     .setChartType('ColumnChart')
//     .setOptions({
//       title: tag + ' — mean temperature by zone',
//       legend: {position: 'none'},
//       vAxis: {title: 'Temperature (°C)'},
//       hAxis: {title: 'Zone'}
//     });

//   /* Both zones in ONE histogram. Two bands -> two series, so the class can
//     see whether the distributions actually separate or merely shift.
//     (There is no ui.Chart.boxplot in Earth Engine — v1 called one and would
//     have thrown on every render.) */
//   var twoZone = LST_C.updateMask(cores.urban).rename('Urban_core')
//     .addBands(LST_C.updateMask(cores.rural).rename('Rural_core'));

//   var histBoth = ui.Chart.image.histogram({
//     image: twoZone, region: AOI, scale: SAMPLE_SCALE_M,
//     maxPixels: 1e10, minBucketWidth: 0.25
//   }).setSeriesNames(['Urban core', 'Rural core'])
//     .setOptions({
//       title: tag + ' — distribution, urban vs rural core',
//       hAxis: {title: 'Temperature (°C)'},
//       vAxis: {title: 'Pixel count'},
//       colors: ['b2182b', '2a9d8f'],
//       interpolateNulls: true
//     });

//   chartPanel.add(meanChart);
//   chartPanel.add(histBoth);

//   // ---- mean temperature by WorldCover class ----
//   var grouped = LST_C.addBands(wc).reduceRegion({
//     reducer: ee.Reducer.mean().group({groupField: 1, groupName: 'class'}),
//     geometry: AOI, scale: STATS_SCALE_M, maxPixels: 1e12
//   });

//   // Server-side lookup: a client-side JS object cannot be indexed inside .map().
//   var WC_NAMES = ee.Dictionary({
//     '10': 'Tree cover', '20': 'Shrubland', '30': 'Grassland', '40': 'Cropland',
//     '50': 'Built-up', '60': 'Bare / sparse', '70': 'Snow & ice', '80': 'Water',
//     '90': 'Herbaceous wetland', '95': 'Mangroves', '100': 'Moss & lichen'
//   });

//   var byClass = ee.FeatureCollection(ee.List(grouped.get('groups')).map(function (g) {
//     g = ee.Dictionary(g);
//     var cls = ee.Number(g.get('class')).toInt();
//     return ee.Feature(null, {
//       class_id:    cls,
//       class_name:  WC_NAMES.get(cls.format('%d'), ee.String('Class_').cat(cls.format('%d'))),
//       LST_mean_C:  ee.Number(g.get('mean'))
//     });
//   }));
//   print(tag + ' — mean °C by WorldCover class:', byClass);
// }


// /* ============================================================
//   8)  SEASONAL COMPARISON  (DAY mode)
//   ============================================================ */

// function uhiOnly(LST_C, cores) {
//   var muU = ee.Number(LST_C.updateMask(cores.urban).reduceRegion({
//     reducer: ee.Reducer.mean(), geometry: AOI,
//     scale: STATS_SCALE_M, maxPixels: 1e10}).get('LST_C'));
//   var muR = ee.Number(LST_C.updateMask(cores.rural).reduceRegion({
//     reducer: ee.Reducer.mean(), geometry: AOI,
//     scale: STATS_SCALE_M, maxPixels: 1e10}).get('LST_C'));
//   return muU.subtract(muR);
// }

// function runSeasonalComparison() {
//   var cores   = currentCores();
//   var useNDVI = useNDVIEmissivityDay.getValue();
//   var aS = winAStart.getValue(), aE = winAEnd.getValue();
//   var bS = winBStart.getValue(), bE = winBEnd.getValue();

//   seasonalLabel.setValue('Computing A vs B…');

//   var colA = dayCandidates(AOI, aS, aE, DAY_MIN_SUNEL, DAY_MIN_VALID);
//   var colB = dayCandidates(AOI, bS, bE, DAY_MIN_SUNEL, DAY_MIN_VALID);

//   ee.Dictionary({a: colA.size(), b: colB.size()}).evaluate(function (sz, err) {
//     if (err) { seasonalLabel.setValue('Server error — see console.');
//               print('Seasonal error:', err); return; }
//     if (!sz.a || !sz.b) {
//       seasonalLabel.setValue('No qualifying scene in window ' +
//         (!sz.a ? 'A' : 'B') + '. Widen the dates or lower DAY_MIN_VALID.');
//       return;
//     }

//     var resA = getDayLST(AOI, aS, aE, DAY_MIN_SUNEL, DAY_MIN_VALID, useNDVI);
//     var resB = getDayLST(AOI, bS, bE, DAY_MIN_SUNEL, DAY_MIN_VALID, useNDVI);
//     var uA = uhiOnly(resA.LST_C, cores);
//     var uB = uhiOnly(resB.LST_C, cores);

//     ee.Dictionary({
//       a: uA, b: uB, delta: uB.subtract(uA),
//       da: resA.date.format('YYYY-MM-dd'), db: resB.date.format('YYYY-MM-dd')
//     }).evaluate(function (d, err2) {
//       if (err2 || !d || d.a === null || d.b === null) {
//         seasonalLabel.setValue('Comparison failed — see console.');
//         if (err2) { print('Seasonal eval error:', err2); }
//         return;
//       }
//       seasonalLabel.setValue(
//         'A ' + d.da + ': ' + d.a.toFixed(2) + ' °C   |   ' +
//         'B ' + d.db + ': ' + d.b.toFixed(2) + ' °C   |   Δ(B−A): ' + d.delta.toFixed(2) + ' °C');

//       var fc = ee.FeatureCollection([
//         ee.Feature(null, {window: 'A · ' + d.da, uhi: d.a}),
//         ee.Feature(null, {window: 'B · ' + d.db, uhi: d.b})
//       ]);
//       chartPanel.add(ui.Chart.feature.byFeature(fc, 'window', ['uhi'])
//         .setChartType('ColumnChart')
//         .setOptions({
//           title: 'Seasonal UHI comparison (DAY mode)',
//           legend: {position: 'none'},
//           vAxis: {title: 'UHI intensity (°C)'},
//           hAxis: {title: 'Scene'}
//         }));
//       print('Seasonal ΔUHI (B − A, °C):', d.delta);
//     });
//   });
// }


// /* ============================================================
//   9)  GO
//   ============================================================ */

// refreshBothModes();
// render();