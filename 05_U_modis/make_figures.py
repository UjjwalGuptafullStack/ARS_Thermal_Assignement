#!/usr/bin/env python3
"""Generate report figures from the Earth Engine CSV exports.

Run from 05_U_modis/:  python3 make_figures.py
Writes PNG + PDF into ../06_report/figures/
"""

import csv, os
from collections import defaultdict
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

TABLES = 'tables'
OUT    = os.path.join('..', '06_report', 'figures')
os.makedirs(OUT, exist_ok=True)

SEASONS = ['Winter', 'Pre-monsoon', 'Monsoon', 'Post-monsoon']

# Colour-blind-safe pair, distinguishable in greyscale print.
C_TERRA, C_AQUA = '#1b6ca8', '#e07b39'
C_URBAN, C_RURAL = '#b2182b', '#2a9d8f'

plt.rcParams.update({
    'font.size': 9, 'axes.spines.top': False, 'axes.spines.right': False,
    'axes.grid': True, 'grid.alpha': 0.25, 'grid.linewidth': 0.5,
    'figure.dpi': 150, 'savefig.bbox': 'tight',
})


def load(name):
    with open(os.path.join(TABLES, name)) as f:
        return list(csv.DictReader(f))


def save(fig, stem):
    for ext in ('png', 'pdf'):
        fig.savefig(os.path.join(OUT, stem + '.' + ext))
    plt.close(fig)
    print('wrote', stem)


def bars(ax, groups, series, values, colors, width=0.38):
    """Grouped bar helper. values[series][group]."""
    x = np.arange(len(groups))
    for i, s in enumerate(series):
        off = (i - (len(series) - 1) / 2) * width
        v = [values[s].get(g, np.nan) for g in groups]
        b = ax.bar(x + off, v, width, label=s, color=colors[i],
                   edgecolor='white', linewidth=0.6)
        ax.bar_label(b, fmt='%.2f', fontsize=7, padding=2)
    ax.set_xticks(x)
    ax.set_xticklabels(groups)
    ax.axhline(0, color='#333', linewidth=0.9)


# ---------------------------------------------------------------
# Fig 1 — seasonal SUHI, day and night, both platforms
# ---------------------------------------------------------------
head = load('Mumbai_MODIS_Seasonal_UHI_headline.csv')

fig, axes = plt.subplots(1, 2, figsize=(10, 4), sharey=True)
for ax, mode in zip(axes, ['Day', 'Night']):
    vals = defaultdict(dict)
    for r in head:
        if r['mode'] == mode:
            vals[r['platform']][r['season']] = float(r['uhi'])
    bars(ax, SEASONS, ['Terra', 'Aqua'], vals, [C_TERRA, C_AQUA])
    ax.set_title('%s  (Terra 10:30 / Aqua 13:30)' % mode if mode == 'Day'
                 else '%s  (Terra 22:30 / Aqua 01:30)' % mode, fontsize=10)
    ax.tick_params(axis='x', rotation=20)
axes[0].set_ylabel('SUHI intensity (°C)')
axes[0].legend(frameon=False, fontsize=8)
fig.suptitle('Seasonal surface urban heat island intensity, Mumbai (MODIS, 2019–2023)',
             fontsize=11, y=1.02)
save(fig, 'fig1_seasonal_suhi')


# ---------------------------------------------------------------
# Fig 2 — day vs night on one axis (the headline contrast)
# ---------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7, 4))
vals = defaultdict(dict)
for r in head:
    if r['platform'] == 'Terra':
        vals[r['mode']][r['season']] = float(r['uhi'])
bars(ax, SEASONS, ['Day', 'Night'], vals, ['#d95f02', '#3b528b'])
ax.set_ylabel('SUHI intensity (°C)')
ax.set_title('Day versus night SUHI, Terra MODIS (2019–2023)', fontsize=10)
ax.legend(frameon=False, fontsize=8)
ax.tick_params(axis='x', rotation=15)
ax.annotate('negative = surface urban COOL island',
            xy=(0.02, 0.04), xycoords='axes fraction', fontsize=7.5,
            style='italic', color='#555')
save(fig, 'fig2_day_vs_night')


# ---------------------------------------------------------------
# Fig 3 — interannual spread
# ---------------------------------------------------------------
per = load('Mumbai_MODIS_Seasonal_UHI_perYear.csv')
fig, ax = plt.subplots(figsize=(7, 4))
pal = {'Winter': '#4575b4', 'Pre-monsoon': '#d73027',
       'Monsoon': '#1a9850', 'Post-monsoon': '#984ea3'}
for s in SEASONS:
    rows = sorted([r for r in per if r['season'] == s], key=lambda r: int(r['year']))
    ax.plot([int(r['year']) for r in rows], [float(r['uhi']) for r in rows],
            marker='o', ms=4.5, lw=1.6, color=pal[s], label=s)
ax.axhline(0, color='#333', lw=0.9)
ax.set_xlabel('Year'); ax.set_ylabel('SUHI intensity (°C)')
ax.set_xticks(range(2019, 2024))
ax.set_title('Interannual variation in seasonal SUHI (Terra day)', fontsize=10)
ax.legend(frameon=False, fontsize=8, ncol=2)
save(fig, 'fig3_interannual')


# ---------------------------------------------------------------
# Fig 4 — rural ring sensitivity
# ---------------------------------------------------------------
ring = load('Mumbai_MODIS_RuralRing_Sensitivity.csv')
order = ['2-20 km', '5-20 km', '10-25 km', '5-30 km']
fig, ax = plt.subplots(figsize=(7.5, 4))
x = np.arange(len(order)); w = 0.2
for i, s in enumerate(SEASONS):
    v = []
    for rg in order:
        m = [r for r in ring if r['season'] == s and r['ring'] == rg]
        v.append(float(m[0]['uhi']) if m else np.nan)
    ax.bar(x + (i - 1.5) * w, v, w, label=s, color=pal[s],
           edgecolor='white', linewidth=0.5)
ax.set_xticks(x); ax.set_xticklabels(order)
ax.axhline(0, color='#333', lw=0.9)
ax.set_xlabel('Rural ring (distance from boundary)')
ax.set_ylabel('SUHI intensity (°C)')
ax.set_title('Sensitivity of SUHI to rural ring definition (Terra day)', fontsize=10)
ax.legend(frameon=False, fontsize=8, ncol=2)
save(fig, 'fig4_ring_sensitivity')


# ---------------------------------------------------------------
# Fig 5 — water inclusion test, the sign reversal
# ---------------------------------------------------------------
wat = load('Mumbai_MODIS_WaterExclusion_Test.csv')
fig, ax = plt.subplots(figsize=(7.5, 4))
x = np.arange(len(SEASONS)); w = 0.38
for i, mode in enumerate(['Day', 'Night']):
    d = [float([r for r in wat if r['season'] == s and r['mode'] == mode][0]['difference'])
         for s in SEASONS]
    b = ax.bar(x + (i - 0.5) * w, d, w, label=mode,
               color=['#d95f02', '#3b528b'][i], edgecolor='white', linewidth=0.6)
    ax.bar_label(b, fmt='%+.3f', fontsize=7, padding=2)
ax.set_xticks(x); ax.set_xticklabels(SEASONS)
ax.axhline(0, color='#333', lw=0.9)
ax.set_ylabel('Change in SUHI when water is included (°C)')
ax.set_title('Effect of retaining water in the rural reference', fontsize=10)
ax.legend(frameon=False, fontsize=8)
ax.annotate('positive = water inflates SUHI    negative = water suppresses SUHI',
            xy=(0.02, 0.93), xycoords='axes fraction', fontsize=7.5,
            style='italic', color='#555')
save(fig, 'fig5_water_test')


# ---------------------------------------------------------------
# Fig 6 — urban vs rural distributions, per season
# ---------------------------------------------------------------
dist = load('Mumbai_MODIS_Distribution_PixelValues.csv')
bykey = defaultdict(list)
for r in dist:
    try:
        bykey[(r['season'], r['zone'])].append(float(r['LST_C']))
    except (ValueError, KeyError):
        pass

fig, axes = plt.subplots(2, 2, figsize=(10, 6.5))
for ax, s in zip(axes.ravel(), SEASONS):
    u, rr = bykey[(s, 'Urban')], bykey[(s, 'Rural')]
    if not u or not rr:
        ax.set_visible(False); continue
    lo = min(min(u), min(rr)); hi = max(max(u), max(rr))
    bins = np.linspace(lo, hi, 40)
    ax.hist(rr, bins=bins, color=C_RURAL, alpha=0.65, label='Rural', density=True)
    ax.hist(u,  bins=bins, color=C_URBAN, alpha=0.65, label='Urban', density=True)
    ax.axvline(np.mean(rr), color=C_RURAL, ls='--', lw=1.3)
    ax.axvline(np.mean(u),  color=C_URBAN, ls='--', lw=1.3)
    ax.set_title('%s   (ΔT = %+.2f °C)' % (s, np.mean(u) - np.mean(rr)), fontsize=9.5)
    ax.set_xlabel('LST (°C)'); ax.set_ylabel('Density')
    ax.legend(frameon=False, fontsize=7.5)
fig.suptitle('Urban and rural LST distributions by season (Terra day, 2019–2023)',
             fontsize=11, y=1.00)
fig.tight_layout()
save(fig, 'fig6_distributions')


# ---------------------------------------------------------------
# Fig 7 — cross-sensor comparison, post-monsoon
# ---------------------------------------------------------------
cmp_ = load('Mumbai_MODIS_Landsat_Comparison.csv')
fig, ax = plt.subplots(figsize=(8, 4))
labels, vals, cols = [], [], []
for mode in ['Day', 'Night']:
    for plat in ['Terra', 'Aqua']:
        for per_ in ['2015 only (matched to Landsat)', '2019-2023 mean']:
            m = [r for r in cmp_ if r['mode'] == mode and r['platform'] == plat
                 and r['period'] == per_]
            if m:
                labels.append('%s %s\n%s' % (plat, mode,
                              '2015' if '2015' in per_ else '2019–23'))
                vals.append(float(m[0]['uhi']))
                cols.append(C_TERRA if plat == 'Terra' else C_AQUA)
b = ax.bar(range(len(vals)), vals, color=cols, edgecolor='white', linewidth=0.6)
ax.bar_label(b, fmt='%.2f', fontsize=7.5, padding=2)
ax.set_xticks(range(len(labels)))
ax.set_xticklabels(labels, fontsize=7.5)
ax.set_ylabel('SUHI intensity (°C)')
ax.set_title('Post-monsoon SUHI: MODIS rows for comparison with Landsat (8–9 Oct 2015)',
             fontsize=10)
ax.annotate("add M's Landsat day/night bars here once the rural\n"
            "definition is reconciled between Part A and Part B",
            xy=(0.60, 0.80), xycoords='axes fraction', fontsize=7.5,
            style='italic', color='#888')
save(fig, 'fig7_cross_sensor')


# ---------------------------------------------------------------
# Fig 8 — valid observations per season (sampling bias)
# ---------------------------------------------------------------
audit = load('Mumbai_MODIS_PixelAudit.csv')
# Mean valid-observation counts measured from the exported rasters.
mean_obs = {'Winter': 15.560, 'Pre-monsoon': 21.249,
            'Monsoon': 10.671, 'Post-monsoon': 20.416}
ncomp = {}
for r in audit:
    if r['platform'] == 'Terra' and r['mode'] == 'Day':
        ncomp[r['season']] = int(r['n_composites'])

fig, ax1 = plt.subplots(figsize=(7.5, 4))
x = np.arange(len(SEASONS)); w = 0.38
b1 = ax1.bar(x - w/2, [ncomp[s] for s in SEASONS], w,
             label='8-day composites available', color='#b8b8b8',
             edgecolor='white', linewidth=0.6)
b2 = ax1.bar(x + w/2, [mean_obs[s] for s in SEASONS], w,
             label='mean valid retrievals per pixel', color=C_TERRA,
             edgecolor='white', linewidth=0.6)
ax1.bar_label(b1, fmt='%d', fontsize=7.5, padding=2)
ax1.bar_label(b2, fmt='%.1f', fontsize=7.5, padding=2)
ax1.set_xticks(x); ax1.set_xticklabels(SEASONS)
ax1.set_ylabel('Count')
ax1.legend(frameon=False, fontsize=8, loc='upper left')

ax2 = ax1.twinx()
ret = [100 * mean_obs[s] / ncomp[s] for s in SEASONS]
ax2.plot(x, ret, color='#d73027', marker='D', ms=5, lw=1.6,
         label='retention (%)')
for xi, r in zip(x, ret):
    ax2.annotate('%.0f%%' % r, (xi, r), textcoords='offset points',
                 xytext=(0, 8), ha='center', fontsize=7.5, color='#d73027')
ax2.set_ylabel('Retention (%)', color='#d73027')
ax2.tick_params(axis='y', colors='#d73027')
ax2.set_ylim(0, 60); ax2.grid(False)
ax1.set_title('Clear-sky sampling: composites available vs retrievals retained',
              fontsize=10)
save(fig, 'fig8_sampling_bias')

print('\nAll figures written to', os.path.abspath(OUT))
