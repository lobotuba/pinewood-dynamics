# Track survey (CHAR-005)

This guide covers how to measure a lane so the solver can race on its real shape, what the software
does with the measurements, and how precise they need to be.

```
npm run survey -- data/surveys/your-track.csv
```

The command fits the survey, reports the fit quality and any suspect stations, and races the demo car
on the measured lane and on the drawing-based BestTrack for comparison. Start from
`data/surveys/EXAMPLE-besttrack-35-synthetic.csv`, which is in the right format but contains no
measurements.

## 1. What to measure

Survey each lane separately; lanes on the same track can differ.

- **Level reference.** Set a laser line level, or a taut string levelled with a line level, along
  the side of the track. Measure from it to the lane surface where the wheels roll. Do not measure to
  the centre guide, and do not use the floor unless you know it is level.
- **Height `z`.** Record height above the reference (up positive). If you measure down from a line,
  record the negative of the distance. Only differences matter.
- **Horizontal position `x`.** Run a tape along the floor, parallel to the track, from a fixed datum
  such as a plumb line from the top end of the start lane. Transfer each station to the lane with a
  square or plumb bob.
- **Station spacing.**
  - 6 in (150 mm) on the straights;
  - 2 in (50 mm) from about a foot before the curve to a foot after it;
  - a station about 1/2 in either side of every section joint, so steps show up.
- **Coverage.** Start at least 6 in (0.15 m) behind the pin, horizontally, so the whole car sits on
  surveyed lane. Finish at least 2 in past the finish sensor.
- **Pin.** Record `pin_x`, the horizontal position of the pin face the car's nose rests against.
- **Finish.** Record `finish_x`, the horizontal position of the lane's timer sensor. Alternatively,
  give `timed_distance` along the lane with its provenance: BestTrack publishes 358, 442 and 526 in
  from the pin.
- **Uncertainty.** Measure five stations twice, at different times, and use the spread as `sigma_z`
  and `sigma_x`. Be honest. The fit uses these numbers to decide how much to smooth, and the outlier
  test assumes they are right.

## 2. File format

```
# name: Church hall BestTrack, lane 2
# source: R. Voss, laser line level and steel rule, 2026-11-07
# measured: true
# units: in              (in, mm or m; applies to everything below)
# sigma_z: 0.01          (one sigma, height)
# sigma_x: 0.03          (one sigma, horizontal position)
# pin_x: 7.19
# timed_distance: 358    (or instead: # finish_x: 351.6)
# timed_distance_provenance: MANUFACTURER
# timed_distance_source: https://www.besttrack.com/track_specs.html
x,z
0.00,48.167
6.00,45.241
...
```

## 3. What the software does

1. **Fits a smooth lane.** `z(x)` is fitted as a natural cubic smoothing spline, which has continuous
   slope and curvature. The amount of smoothing minimizes the unbiased estimate of the fit's error
   against the true lane (UBRE, Wahba 1990), given the stated uncertainties. There is no tuning knob.
   Horizontal uncertainty counts as height uncertainty times the local slope: on the 26° start lane,
   1 mm of `x` error is worth 0.49 mm of height.
2. **Checks every station against the others.** Each station's leave-one-out residual is compared
   with what its uncertainty allows. The threshold is set so an error-free survey trips it somewhere
   only 5% of the time: 3.45σ for 90 stations, 3.67σ for 200, 3.84σ for 400. A flagged station is
   a misreading, a step at a joint, or a sign that the stated uncertainty is too small. Re-measure
   the worst station first and refit, because one bad station can drag its neighbours over the line.
3. **Builds the wheel paths exactly.** Arc length uses 8-point Gauss–Legendre quadrature, accurate to
   1e-13 m on each interval. Each wheel centre follows the exact offset curve. A lane with a dip too
   tight for the wheel is rejected.
4. **Labels the result.** The profile is `MEASURED` (TRK-004) and the result record carries the
   survey's source line and fit summary.

**Not modelled.** A step at a section joint is a bump the car hits, not a smooth curve. The fit will
smooth it and usually flag it. If the survey shows steps, they need fixing on the track, or modelling
as impacts in a later release.

## 4. How precise does the survey need to be?

`npm run survey:precision` answers this. It takes the drawing-based BestTrack 35 ft lane as the
truth and generates surveys of it with random measurement errors. It fits each survey, races the demo
car on it, and compares the time with the time on the exact lane: 2.6230 s. Each case uses 8
seeds, the same seeds in every case. Errors are in milliseconds.

| Survey | Mean | Spread (1σ) | Worst of 8 |
|---|---|---|---|
| 25 mm spacing, height σ 0.25 mm | −0.21 | 0.48 | 1.14 |
| 25 mm, 0.5 mm | −0.45 | 0.86 | 2.08 |
| 25 mm, 1 mm | −0.94 | 1.47 | 3.50 |
| 25 mm, 2 mm | −1.82 | 2.45 | 5.59 |
| 50 mm, 0.25 mm | −0.13 | 0.61 | 1.05 |
| 50 mm, 0.5 mm | −0.26 | 1.14 | 2.16 |
| 50 mm, 1 mm | −0.57 | 2.06 | 4.35 |
| 50 mm, 2 mm | −1.33 | 3.63 | 8.39 |
| 100 mm, 0.25 mm | −0.04 | 0.76 | 1.32 |
| 100 mm, 0.5 mm | −0.10 | 1.44 | 2.51 |
| 100 mm, 1 mm | −0.28 | 2.65 | 4.56 |
| 100 mm, 2 mm | −0.78 | 4.64 | 7.79 |
| 50 mm, height 0.5 mm, horizontal 1 mm | −0.57 | 1.45 | 2.56 |
| 50 mm, height 0.5 mm, horizontal 3 mm | −0.88 | 1.96 | 3.51 |
| Exact lane, pin located to 1 mm | −0.03 | 0.33 | 0.45 |
| Exact lane, pin located to 3 mm | −0.07 | 0.98 | 1.36 |
| Exact lane, pin located to 10 mm | −0.24 | 3.26 | 4.56 |

The means are within their sampling error of zero. They grow with the height error only because
every case reuses the same seeds.

**Findings:**

1. **Height precision matters most.** Each millimetre of height error adds about 2 ms of spread at
   50 mm spacing. Closer stations help only slowly: halving the spacing cuts the spread by about a
   quarter.
2. **Station spacing alone hardly matters.** With error-free heights, a survey at 20 cm spacing
   reproduces the exact lane's time to 0.3 µs, and at 10 cm or closer to about 10 ns
   (`test/p0-survey.test.ts`).
3. **Horizontal error matters on the slope,** at roughly half the effect of the same height error.
4. **The pin position matters:** about 0.33 ms per millimetre. Locate the pin face to 1 mm.
5. **Survey error largely cancels when comparing cars on the same lane.** With 1 mm height error at
   50 mm spacing, one car's absolute time is uncertain by ±2.1 ms. The difference between a CG-0.5 in
   and a CG-3 in car (20.1 ms) is uncertain by only ±0.46 ms over the same 8 surveys.

**Recommendation:**
- heights to 0.5 mm (0.02 in) or better;
- horizontal positions to 1 mm;
- stations every 50 mm (2 in) through the transition and 150 mm (6 in) on the straights;
- the pin face to 1 mm.

That puts survey error at about ±1.5 ms on absolute time and well under 1 ms on differences between
cars. That is small beside the effects being tested: the Duke experiment's mass and CG effects were
94 and 140 ms (`docs/validation.md`), and its run-to-run scatter was several milliseconds.
