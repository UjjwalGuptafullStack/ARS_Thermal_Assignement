# Characterising the Urban Heat Island — Mumbai

Advanced Remote Sensing, Assignment 1. Two linked analyses of the same
city, split by data product.

- **Part A** — day/night UHI from Landsat 8 (8–9 October 2015) — Maithily Bhala
- **Part B** — seasonal UHI from MODIS (Terra + Aqua, 2019–2023) — Ujjwal Gupta

**Report:** [`06_report/UHI_report.tex`](06_report/UHI_report.tex) ·
[compiled preview](06_report/UHI_report_PREVIEW.pdf)

## Layout

```
01_brief/       assignment brief
02_scripts/     the two Earth Engine scripts (current versions)
03_boundary/    GADM v4.1 boundary as uploaded to Earth Engine
04_M_landsat/   Part A results: v2_tables/ (CSV) + v2_rasters/ (GeoTIFF, gitignored)
05_U_modis/     Part B results (tables, rasters, zone masks) + make_figures.py
06_report/      LaTeX source, compiled preview, and every figure
07_reference/   tutorial script provided with the assignment
archive/        superseded material — see below
```

`04_M_landsat/v2_rasters/` is listed in `.gitignore` (five ~30 MB
GeoTIFFs); the CSVs in `v2_tables/` carry every number the report
cites and are tracked, so the rasters are regenerable but not required
to check the report's figures.

## What's in `archive/`

Earlier work, kept for history but not needed to read or check the
report:

- `M_landsat_v1_outputs/` — first Landsat run, before the rural
  reference was moved outside the city (see the report's "Reconciling
  the two parts" section for why it changed)
- `M_landsat_v1_report.docx`, `M_landsat_v1_notes.txt` — early
  standalone draft and working notes
- `U_partB_standalone_superseded.tex` — Part B report before it was
  merged into the combined `UHI_report.tex`
- `mumbai_qgis_project/` — a QGIS project used for boundary checks,
  not part of the Earth Engine analysis

## Earth Engine scripts

| Part | Script | Link |
|---|---|---|
| A | `02_scripts/M_landsat_daynight.js` | [code.earthengine.google.com/c1128abf…](https://code.earthengine.google.com/c1128abfeafdf724eb9a03f539625722) |
| B | `02_scripts/U_modis_seasonal.js` | [code.earthengine.google.com/f00b8b39…](https://code.earthengine.google.com/f00b8b3999cd01e32f97a9d001740569) |

Both run top to bottom without editing.

## Shared definitions

Both parts use identical zones, so differences between them come from
sensor and season rather than method.

| | |
|---|---|
| Boundary | GADM v4.1 level-2, EPSG:4326, 481.56 km² (Greater Mumbai, despite the "Mumbai City" GADM label — see the report) |
| EE asset | `projects/ee-ujjwalguptaug0611/assets/Mumbai_AOI_FINAL` |
| Urban | WorldCover class 50, inside boundary, water excluded |
| Rural | Classes 10/20/30/40/60, 5–20 km ring, water + wetland excluded |
| Stats scale | 100 m (Landsat), 1000 m (MODIS) |

## Headline results

**Part A** — Landsat, 8–9 Oct 2015, external ring:

| | UHI (°C) |
|---|---:|
| Day LST | +2.39 |
| Night brightness temperature (no correction) | +1.15 |
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
(+2.09) agree to within 0.04 °C despite sharing almost no methodology.

## Reproducing

1. Upload `03_boundary/Mumbai_AOI_FINAL.zip` as an Earth Engine asset
   and set `AOI_ASSET` at the top of each script.
2. Run each script; start the export tasks from the Tasks tab.
3. Drop the downloaded CSVs/rasters into `04_M_landsat/v2_tables/`,
   `04_M_landsat/v2_rasters/`, or `05_U_modis/tables/` as appropriate.
4. `cd 05_U_modis && python3 make_figures.py` regenerates every chart
   from the tracked CSVs.
5. Compile `06_report/UHI_report.tex` (needs `siunitx`; Overleaf works).

## Outstanding before submission

- One reference (`imd_climate_normals`) needs its Mumbai/Santacruz
  figures cross-checked against the primary IMD PDF — currently
  sourced via a secondary citation, flagged with a `\TODO` in the
  bibliography.
- Rename the compiled PDF to `RollNo._UHI.pdf` before submitting.
