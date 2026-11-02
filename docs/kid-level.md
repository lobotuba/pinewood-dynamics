# KID level

The experience level (MODE-001) picks what the workspace shows: **Kid** or **Builder**, in the top bar,
remembered between sessions. It is presentation only. It never enters the design file, the solid, the
physics or the inspection, so the same car is judged the same at every level. Switching back to Builder
shows the car the child made, with every number.

This is the first slice of the KID level (spec 16, 12.7 A). Add Parts (12.7 B, DSN-001..006) is next.
The Engineering level is not offered yet: Builder already shows provenance and the energy residual.

## The kid workspace (`src/app/kidPanel.ts`)

The 3D car fills the left, the kid panel the right. The profile editors, the Builder panels, the view
toggles, the units and the compliance context are hidden. The context is still applied: in CERTIFIED,
a change that breaks a rule is refused, with a plain-words reason (`kidRefusal`).

- **Header:** the car's name, its state in words ("Follows the race rules", "Needs fixing: see Why?",
  "Practice car" in SANDBOX), a weight meter against the rule limit in words ("room for more weight",
  "almost full", "right at the limit", "too heavy"), and the race preview's time.
- **Show numbers:** numbers are hidden unless this is ticked (spec 16). It adds masses and
  seconds; the race time is always shown.
- **Steps:** Shape It, Add Weight, Why?, Race, Build It.

### Shape It (`src/kid/shapes.ts`)

- **Pick a shape:** Block, Wedge, Low rider, Pickup, Arrow, Bullet. Each is a side and a top outline on
  the kit's block, made of saw lines (the Bullet's roof is one arc), so it is sawn at the BASIC tier.
  Heights are fractions of the block's, raised where needed to leave at least 3/8 in of wood over each
  axle slot. The Arrow's point starts 0.35 in ahead of the front axle, so its slot keeps both sides.
  Picking a shape replaces the outlines and the saw cuts; holes stay, and kid weights are put back into
  the wood at the nearest place they fit, or taken out (the child is told).
- **Draw a saw line:** drag across the side view. The line becomes a saw cut through the whole width
  (a plane `Cut`, the same feature Builder uses), taking off the side away from the middle of the
  outline. A line too short, or one that would leave less than 1/4 in of wood either side of an axle
  slot's centre, is refused with the reason.
- **Paint colour.**

### Add Weight (`src/kid/weights.ts`)

Weights are rods across the car in holes drilled from the left side, the way kit weights are usually
fitted: big and small tungsten rods, a steel rod, a small steel rod for topping up, and a lead rod
(SAF-003: "a grown-up puts it in", the lead notice, and the non-lead alternative in words). Names are
generic (DSN-004). A rod is the block's width less 1/8 in at each end, at most 1.5 in long, with its
axis 0.45 in above the bottom, clear of the slots.

- A new rod starts as far back as it fits. A slider moves it from back to front.
- A rod only goes where there is 1/16 in of wood over it along its length and beyond both ends, and
  1/16 in between it and other weights (`rodFits`). Asked for a place without room, it goes to the
  nearest place with room. With room nowhere, the child is told.
- Each rod's access hole (`accessHole`) is drilled with it and moves with it. Its id pairs with the
  rod's (`kw…`, `kb…`).
- The balance point is described in words (`balanceWords`).

### Why? (`src/kid/whatIf.ts`, `src/kid/words.ts`)

- **Race rules:** every failed check in plain words, with what to try (`kidProblem`). If none fail, it
  says so, and notes that sizes are guesses until the kit is measured.
- **What makes it faster?** The car is raced again by the same solver on the same track with one
  change at a time: the kid weights 1/2 in further back, 1/2 in further forward, the car as heavy as
  the rules allow (a point mass at the CG, so the CG and pitch inertia are unchanged), and polished
  axles if they are not. The difference is said as car lengths at the finish (time difference ×
  finish speed ÷ car length): "about level", "a nose ahead", "about a car length behind". Nothing here
  is a rule of thumb: the answer is the physics' (VIS-002), and it inherits the solver's estimated
  inputs, which the page says.

### Race and Build It

- **Race** opens race mode, where saved versions race as ghosts.
- **Build It** prints the same templates and build sheet as Builder (watermarked SANDBOX for a practice
  car), lists the operations, and says to build with a grown-up who uses the saw and the drill.

## Tests

`test/kid.test.ts`:

- every shape on every kit is a body, BASIC, keeps 3/8 in over both axle slots, and passes the starter
  rules; the Bullet's arc bows outward;
- a saw line takes off the piece away from the middle whichever way it is drawn, and is refused when
  short or near a slot;
- weights start at the back, keep their wood and spacing, run out of room, go to the nearest place
  that fits, and survive a shape change or come out;
- each what-if changes one thing: weights moved, mass to the limit at the same CG and inertia, axles
  polished;
- the plain words: problems, refusals, balance point and car lengths.
