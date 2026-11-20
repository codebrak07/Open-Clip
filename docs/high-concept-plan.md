# High-Concept Satire Engine Plan & Architecture

> **Module:** OpenClip Story Studio — High-Concept Satire Engine  
> **Status:** APPROVED FOR IMPLEMENTATION  
> **Input:** One-line social TAG (e.g., *"college placements"*, *"Instagram followers"*, *"attendance percentage"*, *"credit score"*)  
> **Core Abstraction:** Generalized Status & Metric Satire (`StatusTag`, `StatusEngine`, `StagingSolver`). No domain-specific identifiers (e.g. "JEE", "AIR") exist in engine code; all metrics are dynamically synthesized.

---

## 1. System Architecture & Pipeline Flow

The High-Concept Satire Engine extends the Story Studio DAG with two new pre-production stages (**ConceptStage**, **DirectorStage**) and an automated **VisualQAStage**:

```
[User One-Line TAG]
        │
        ▼
┌────────────────────────────────────────────────────────┐
│ 0. ConceptStage (3 candidates generated -> Critic/UI)  │
│    - WorldConcept JSON (Zod closed-vocabulary)         │
│    - Gap logging to docs/catalog-requests.json         │
└───────────────────────┬────────────────────────────────┘
                        │ Approved Concept
                        ▼
┌────────────────────────────────────────────────────────┐
│ 1. CastGenerator & StatusEngine                        │
│    - Up to 12 characters (<= 4 speaking, 8 silent extras)│
│    - Metric values distributed across tiers            │
│    - StagingSolver: higher status strictly >= lower Y  │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 2. ScriptStage (Writer + Critic + Punch-Up)            │
│    - Formula: "In this world, [rule]..." opening line  │
│    - 3-4 rising set pieces + visual ironies            │
│    - Concealment hide-and-reveal gag + button gag      │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 3. DirectorStage (Cinematography Rules)                │
│    - Low-angle on high status, high-angle on low status│
│    - Setup -> Beat -> Reaction camera choreography     │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 4. Voice & Audio Mix (Kokoro / Orpheus / macOS Say)    │
│    - Word-level Whisper alignment & procedural SFX     │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 5. BlockWorld Quality Governor & 9:16 Renderer         │
│    - Benchmark first 30 frames; pick draft/std/high    │
│    - Billboard StatusTag Plate (>= 40px, "???" hidden) │
│    - Platforms, pits, ladders, concealer cloth sway    │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ 6. VisualQA & ExportStage                              │
│    - Automated checks: tag readability, status Y-order │
│    - Burnt-in story_pop captions & 4 sidecars exported │
└────────────────────────────────────────────────────────┘
```

---

## 2. WorldConcept Schema & Zod Definition

```ts
export const WorldConceptSchema = z.object({
  tag: z.string().min(1),
  openingLine: z.string().regex(/^In this world,\s+/i, 'Must begin with "In this world, "'),
  metric: z.object({
    name: z.string(),
    format: z.enum(['indian_grouping', 'plain', 'percent', 'ordinal', 'currency_inr', 'k_m']),
    direction: z.enum(['lower_is_better', 'higher_is_better']),
    min: z.number(),
    max: z.number(),
  }),
  display: z.enum(['tag', 'meter', 'badge', 'body_scale']),
  tiers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    minVal: z.number(),
    maxVal: z.number(),
    color: z.string(), // Hex or catalog color id
  })).min(3, 'Must have at least 3 tiers covering min..max with no gaps or overlaps'),
  effects: z.object({
    housing: z.record(z.string()),    // tierId -> home catalog id
    elevation: z.record(z.string()),  // tierId -> platform catalog id
    treatment: z.record(z.string()),  // tierId -> treatment catalog id
  }),
  ironies: z.array(z.object({
    roleOrJob: z.string(),
    value: z.number(),
    effect: z.string(),
  })).min(1, 'Must include at least 1 societal irony'),
  concealment: z.object({
    mechanic: z.string(),
    item: z.string(), // Must be valid concealer catalog id
    reactions: z.array(z.string()).min(1),
  }),
  setPieces: z.array(z.object({
    id: z.string(),
    location: z.string(),  // Must be catalog location id
    formation: z.string(), // Must be catalog formation id
    gag: z.string(),
    escalation: z.string(),
  })).min(3).max(4),
  twist: z.string().min(1),
  buttonGag: z.string().min(1),
  callback: z.string().min(1, 'Opening rule must pay off in the ending'),
});
```

### 2.1 Unknown Catalog ID Handling & Gap Reporting
When LLM proposes an uncataloged item (e.g. `"bunker"` or `"monocle"`):
1. Compute string Levenshtein & semantic distance to valid catalog entries.
2. Substitute the closest valid catalog id (e.g. `"bunker"` -> `"garage"`).
3. Append the proposed id, context, and mapped substitution to `docs/catalog-requests.json`.
4. The renderer strictly receives validated catalog ids.

---

## 3. Catalog Expansion (`assets/story/catalog.json`)

The closed vocabulary expands to support all satirical mechanics:
- **Homes (8)**: `mansion`, `villa`, `flat`, `hut`, `garage`, `tent`, `treehouse`, `cardboard_box`.
- **Platforms / Elevation (7)**: `stage`, `balcony`, `podium`, `ground`, `pit`, `ladder`, `staircase`.
- **Concealers (9)**: `scarf`, `hoodie`, `paper_bag`, `bucket`, `helmet`, `towel`, `box`, `cap`, `sunglasses_mustache` *(Zero religious or cultural headwear permitted)*.
- **Treatments (9)**: `bow`, `red_carpet`, `queue_skip`, `ignore`, `shoo_away`, `look_down`, `fan_crowd`, `gossip_whisper`, `security_check`.
- **Formations (7)**: `tiered_crowd`, `queue`, `wedding_hall`, `town_hall`, `staircase`, `circle`, `red_carpet`.
- **Locations (11)**: `mansion_exterior`, `garage_office`, `wedding_hall`, `town_square`, `school_gate`, `office_lobby`, `mall`, `bus_stop`, `college_gate`, `cricket_ground`, `hospital_lobby`.
- **Props (8)**: `garland`, `trophy`, `scanner`, `ladder`, `megaphone`, `mic`, `umbrella`, `velvet_rope`.
- **SFX (9)**: `crowd_gasp`, `crowd_murmur_loop`, `reveal_ding`, `womp_womp`, `bow_whoosh`, `fabric_flap`, `scanner_beep`, `cheer`, `wind_gust`.

---

## 4. Cast & Status Engine + Staging Solver

### 4.1 Cast Composition
- **Total visible characters per scene**: Up to 12.
- **Speaking roles**: Up to 4 (including Narrator).
- **Silent extras**: Up to 8 reacting with procedural expressions, head turns, and visual emote bubbles.

### 4.2 StatusEngine Logic
```ts
function resolveStatusTier(value: number, concept: WorldConcept): StatusTier {
  const isLowerBetter = concept.metric.direction === 'lower_is_better';
  // Sort tiers by rank priority
  return concept.tiers.find(t => value >= t.minVal && value <= t.maxVal) || concept.tiers[0];
}
```

### 4.3 Staging Solver (Property-Tested)
- **Rule 1 (Monotonicity)**: Character with higher societal status is **never** placed at a lower world Y coordinate or lower viewport Y coordinate than a character with lower status:
  $$\text{Status}(A) > \text{Status}(B) \implies Y(A) \ge Y(B)$$
- **Rule 2 (Hierarchy of Heights)**: High-status characters occupy stages/balconies; low-status characters stand in pits, lower steps, or floor level. Bottom-tier characters sit at the bottom edge of the frame, optionally partially cropped for comic effect.
- **Rule 3 (Overlap & Tag Clearance)**: Bounding boxes of StatusTags are separated by `>= 15px`; camera adjusts elevation to ensure tags never intersect subtitle safe margins.

---

## 5. Renderer: Visual Status Tags & Quality Governor

### 5.1 StatusTag Billboard Mesh
- Placed `0.45m` above head bone.
- Dimensions: `>= 40px` height at 1080px frame width.
- Visual styles:
  - `tag`: Rounded pill plate with tier hex color border and bold numeric text.
  - `meter`: Horizontal fill bar (0% to 100%).
  - `badge`: Star / shield icon with value.
  - `body_scale`: Character mesh scales from 0.7x to 1.3x based on status.
- Concealment: When covered by concealer mesh (e.g. scarf, paper bag), the tag displays `"???"` until the reveal beat triggers.

### 5.2 Quality Governor Benchmark
- Target wall-clock duration: `<= 180s` (3 min) for a 45–60s video on Apple Silicon M4.
- During frame 1–30 generation, measure `elapsedMs`:
  - If project projected total time `<= 120s`: Run **High Tier** (1080x1920, 2x supersampling, PCFSoft shadows, toon outlines, subtle vignette).
  - If projected time `<= 180s`: Run **Standard Tier** (1080x1920, 1x MSAA, sharp shadows).
  - If projected time `> 180s`: Downscale to **Draft Tier** (540x960 upscaled to 1080x1920) and log governor downgrade in `report.json`.

---

## 6. Satire Guardrails & Safety Filter

To guarantee ethical and high-impact satire:
1. **Target of Satire**: Must strictly target societal systems, arbitrary metric obsession, bureaucratic absurdity, and groupthink.
2. **Strict Exclusions**:
   - ZERO references to real living people, politicians, or celebrities.
   - ZERO real institutions, companies, coaching institutes, or educational brand names.
   - ZERO discrimination or jokes targeting caste, religion, ethnicity, region, disability, gender, or body shape.
   - ZERO mention of self-harm, academic distress, suicide, depression, or violence.
3. **Automated Guardrail Evaluator**:
   - Pre-prompt constraints + Post-generation regex/keyword scanner with automated sanitization.
   - Warm, relatable resolution where character humanity triumphs over numbers.

---

## 7. Milestone Plan

- **Milestone C1**: Concept Engine (`ConceptStage.ts`, `WorldConceptSchema`, catalog expansion, gap logger, guardrails filter).
- **Milestone C2**: Cast Generator, generalized `StatusEngine.ts`, and mathematical `StagingSolver.ts` with 1,000-iteration property tests.
- **Milestone C3**: BlockWorld Renderer upgrades: `StatusTag` billboard plates, concealer cloth sway/blow-off animations, platform/pit elevation geometry, quality governor.
- **Milestone C4**: Director Stage (`DirectorStage.ts`), cinematography rules, visual QA draft sampling, and new procedural satire SFX cues.
- **Milestone C5**: REST API endpoints, React concept preview UI card, test suite, and generation of 3 distinct benchmark videos (Tag A: *"JEE rank"*, Tag B: *"Instagram followers"*, Tag C: *"attendance percentage"*).
