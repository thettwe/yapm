## MODIFIED Requirements

### Requirement: Open to merged is drawn as a distribution, with the median where it falls

The Delivery view SHALL draw the open→merged durations of the window's merged changes as a
**distribution** on a linear axis from zero to the largest observed duration: one mark per merged
change, positioned by its own duration.

The **median SHALL be drawn at its own position on that axis** and SHALL be the same value the page
states as a number elsewhere — never a second computation, and never a figure quoted from a summary
while the marks are drawn from another population.

The chart SHALL state **what one mark represents**, and one mark SHALL be one merged pull request: a
pull request linked to more than one issue in scope SHALL be drawn once and counted once. Marks at
the extreme of the axis SHALL be called out with the count and the fact, stated in words.

The axis SHALL remain linear and SHALL include the extremes; no mark SHALL be clipped, bucketed or
rescaled away.

The chart's callouts SHALL stay **legible at every data shape**. Two callouts SHALL NOT be drawn on
one baseline unless a stated minimum separation holds between them; where it does not, a callout
SHALL be drawn on its own baseline instead. Separation SHALL be decided by a single derivation over
the callouts' drawn positions and estimated widths, and that estimate SHALL NOT under-measure any
type face the product's presets bind to the mono role. This SHALL hold when the median sits close to
the outlier group, when the population has no outliers, when the crowd is compressed at the left of
the axis, and when a callout would otherwise read off the edge of the drawing.

#### Scenario: The median is a position, not a quotation

- **WHEN** a member reads the distribution
- **THEN** the median is drawn at its own place on the axis, and the value drawn there is the same value the page's number states

#### Scenario: One mark is one merged change

- **WHEN** a merged pull request is linked to two issues that both touched the window
- **THEN** the distribution draws exactly one mark for it, the chart states that one mark is one merged pull request, and the number of marks equals the number of distinct merged pull requests in the window

#### Scenario: The outliers are named rather than hidden

- **WHEN** the window contains changes that took far longer than the rest
- **THEN** they are drawn at their true position on a linear axis and called out in words with their count, and the axis is neither clipped nor rescaled to hide them

#### Scenario: Two callouts never run together

- **WHEN** the crowd callout and the outlier callout would be drawn closer than the stated minimum separation on one baseline — including when a long axis pushes the median callout and the outlier callout to nearly touch
- **THEN** the outlier callout is drawn on its own baseline, and neither callout's text overlaps or abuts the other's

#### Scenario: A population with no outliers draws one callout, undisturbed

- **WHEN** no merged change in the window qualifies as an outlier
- **THEN** exactly one callout is drawn, on the drawing's own baseline, and it is not displaced by a separation rule with nothing to separate it from
