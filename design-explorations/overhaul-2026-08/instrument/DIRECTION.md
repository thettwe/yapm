# Direction: instrument — data-forward hero

**Thesis.** The work graph is the visual protagonist. yapm keeps Warm's paper, hairlines and
terracotta untouched [token] and spends every new pixel on drawn delivery data [structural]:
a flight-strip lane per row, a permanent statusline, and a Delivery view rebuilt as an
instrument panel instead of a tile grid. Bloomberg's discipline, Warm's palette.

## What moved vs today

- **Issue rows** [structural]: the 86px four-dot reality strip becomes a 160px lane at the row's
  right edge — PR→CI→REV→DEP nodes on a drawn track, elapsed times in 8px mono beneath, reached
  track solid, unreached dashed, divergence as an urgent-toned track break (`//`). Rows stay 44px;
  11 rows + 3 group headers fit the first 900px, same count as today.
- **Statusline** [structural]: one mono line at the app's bottom edge on every surface — team ·
  cycle day · shipped · open PRs · CI health · deploys/wk · divergence count · sync state.
- **Delivery** [structural]: masthead is a ship-cadence dot strip on a real Feb→Aug time axis with
  cycle boundaries ruled; below it the cycle flow band (stacked shipped/carried/canceled bars with
  carry ribbons), a mono readout table, small multiples on a shared cycle axis, and an annunciator
  row where zero renders dim but never hidden. The honest "not measured yet" footnote survives.
- **Issue detail** [structural]: the delivery rail is the right column's hero — a vertical metro
  line (PR → reviews → merge → CI → track break → absent deploy) above a divergence callout with
  keyboard actions; properties demoted below it.
- **Palette** [structural]: results carry inline reality glyphs in mono (`pr✓ ci✓ dep ∅ 1d`);
  the footer speaks the statusline language and keeps the key hints.
- **Everything painted** [token]: colors, radii, fonts, densities are the Warm LIGHT block verbatim.
  Extensions (noted per file): track inks #cbc2b2/#e0d8c9 from the border ramp, hazard = existing
  status-urgent reused as a drawn break, statusline bg #f4efe5 (bg↔sidebar midpoint), soft washes
  of status-in-progress/status-urgent for lit annunciator cells and carry ribbons.
- **Team-level only**: no assignee appears in any metric, lane, or statusline segment.

## Self-critique

- issue-list: the lane column earns its width, but empty lanes (7 of 11 rows) spend 160px saying
  "nothing yet" — a no-PR row may deserve a quieter single dash.
- issue-detail: rail hero works, but the left column is now the emptiest surface in the app; the
  hierarchy inversion begs for activity/graph content on the left to balance it.
- delivery: densest and best surface, though the cadence strip's pre-window months (Feb–May) spend
  half the masthead on context the window ignores.
- palette: reality glyphs read well, but three mono abbreviation dialects (lane captions, palette
  glyphs, statusline) are drifting apart — production would need one shared vocabulary.
