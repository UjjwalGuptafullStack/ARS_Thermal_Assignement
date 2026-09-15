# Characterising the Urban Heat Island — Mumbai

Advanced Remote Sensing, Assignment 1. Two linked analyses of the same
city, split by data product.

- **Part A** — day/night UHI from Landsat 8 (8–9 October 2015)
- **Part B** — seasonal UHI from MODIS (Terra + Aqua, 2019–2023)

## Layout

```
01_brief/       assignment brief
02_scripts/     the two Earth Engine scripts
03_boundary/    GADM v4.1 boundary as uploaded to Earth Engine
04_M_landsat/   Part A outputs, notes, QGIS project
05_U_modis/     Part B outputs + figure-generation script
06_report/      LaTeX source and figures
07_reference/   tutorial script (lecture decks excluded from git)
```

## Earth Engine scripts

| Part | Script | Link |
|---|---|---|
| A | `02_scripts/M_landsat_daynight.js` | [code.earthengine.google.com/c1128abf…](https://code.earthengine.google.com/c1128abfeafdf724eb9a03f539625722) |
| B | `02_scripts/U_modis_seasonal.js` | [code.earthengine.google.com/f00b8b39…](https://code.earthengine.google.com/f00b8b3999cd01e32f97a9d001740569) |

`M_landsat_daynight_v1_original.js` is the first version, kept for the
reference-definition sensitivity test.

## Shared definitions

Both parts use identical zones, so differences between them come from
sensor and season rather than method.

| | |
|---|---|
| Boundary | GADM v4.1 level-2, EPSG:4326, 481.56 km² |
| EE asset | `projects/ee-ujjwalguptaug0611/assets/Mumbai_AOI_FINAL` |
| Urban | WorldCover class 50, inside boundary, water excluded |
| Rural | Classes 10/20/30/40/60, 5–20 km ring, water + wetland excluded |
| Stats scale | 100 m (Landsat), 1000 m (MODIS) |

## Headline results

**Part A** — Landsat, 8–9 Oct 2015, external ring:

| | UHI (°C) |
|---|---:|
| Day LST | +2.39 |
| Night brightness temperature | +1.15 |
| Night LST (emissivity corrected) | +2.13 |

**Part B** — MODIS Terra, 2019–2023 means:

| Season | Day | Night |
|---|---:|---:|
| Winter | −0.41 | +2.80 |
| Pre-monsoon | −2.72 | +1.90 |
| Monsoon | +0.07 | +1.73 |
| Post-monsoon | +1.67 | +2.38 |

Daytime UHI is negative in winter and pre-monsoon — a surface urban
*cool* island — while night-time UHI is positive in every season.

Landsat night LST (+2.13) and MODIS Terra night for post-monsoon 2015
(+2.09) agree closely, which is useful corroboration across two
independent sensors.

## Reproducing

1. Upload `03_boundary/Mumbai_AOI_FINAL.zip` as an Earth Engine asset
   and set `AOI_ASSET` at the top of each script.
2. Run each script; start the export tasks from the Tasks tab.
3. Drop the downloaded CSVs into `05_U_modis/tables/`.
4. `cd 05_U_modis && python3 make_figures.py` regenerates every figure.
5. Compile `06_report/UHI_report.tex` (needs `siunitx`; Overleaf works).

## Outstanding

- Interpretation sections in the report (marked `\TODO` in red)
- IMD citation for the season definition
- DOIs and access dates in the reference list
- Part A maps and distribution plots to render from the exported rasters
- Final PDF to be renamed `RollNo._UHI.pdf`
