# Reference Bible: Roblox-Style Story-Time 9:16 Video

> **Ground Truth Document**: This document completely specifies the reference-grade format for OpenClip Story Studio v2 ("reference-grade story-time videos from one tag").

---

## 1. Format & Overview
- **Aspect Ratio**: 9:16 Vertical (`1080x1920`).
- **Framerate**: 30.0 fps constant framerate.
- **Duration**: ~100s target (writer range: 45s – 100s).
- **Genre / Style**: Animated Roblox-style vertical story-time.
- **Voiceover**: A single continuous first-person narrator ("I") telling a funny, warm, concrete, all-ages story.
- **Visuals**: Blocky 3D avatars act out the story in sync with the narration, featuring animated expressions, procedural body clips, detailed printed outfit textures, hair kits, and low-poly 3D environments.
- **Captions**: Big, bold, burnt-in captions placed safely at 12%–20% from the top of the frame.
- **Audio**: Layered sound effects on every visual action, environmental room tone/ambience, ducked under the voiceover (-12 dB), integrated loudness -14 LUFS (±1.0 LUFS), true peak <= -1.0 dBFS.

---

## 2. Measured Metrics & Target Thresholds
| Metric | Reference Target | Minimum Passing Threshold |
|---|---|---|
| **Framerate & Aspect** | 30 fps, 9:16 (`1080x1920`) | 30 fps, 9:16 |
| **Duration** | 45s – 100s (Default ~90s–100s) | 45s – 100s |
| **Pacing / Hard Cuts** | 37 cuts (~22/min, 1 per ~2.7s) | >= 15 hard cuts / minute (max hold <= 3.0s) |
| **Narration Cadence** | 3.5 words/second (continuous) | 3.0 – 4.0 words/second |
| **Silent Gaps** | 0 gaps >= 0.25s (except <= 0.6s reveal pause) | Dead air <= 5% of total runtime |
| **Audio Loudness** | -14.4 LUFS (integrated) | -14.0 LUFS ± 1.0 LUFS; Peak <= -1.0 dBFS |
| **Captions Rate** | 1 card per ~0.75s (2–4 words per card) | Words/card: 2–4; Coverage >= 95% |
| **Captions Stale Cards** | 0 stale cards (cards span from start of 1st word to start of next card) | 0 stale/reappearing cards |
| **Captions Placement** | 12% – 20% from top of 9:16 frame | Face clearance in 100% of frames |
| **Visual Event Coverage** | 100% of caption cards have a visual event | >= 90% of cards map to a visual event |
| **Environments** | ~6 distinct environments | >= 3 per 45s; >= 5 per 90s |
| **Characters & Cast** | 8+ distinct avatars + creatures | >= 4 per 45s; >= 8 per 90s |
| **Opening Hook** | Starts with `"In this <place>,"` + rule visual proof <= 3.0s | Hook within 3.0s (proof <= 3.0s) |
| **SFX Density** | SFX on every visual event | >= 6 SFX events / minute |

---

## 3. Structural Breakdown (Time Fractions)
- **0–3s: HOOK (Absolute Timing)**
  - Wide shot of a bright friendly town with two avatars chatting.
  - Narrator states the world rule in the form `"In this <place>, ..."`.
  - Low-angle ground shot where the rule's first visual effect pops at their feet in a puff of white spheres within 3s (~2.6s).
- **3%–12%: RULE MECHANICS**
  - 3–4 quick cuts of cause -> effect -> reaction.
  - The effect travels to its target and delivers. Severity scales size/intensity (tiny vs huge); shocked facial expressions.
- **12%–23%: SOCIETY ADAPTS ABSURDLY**
  - Crowd-scale gag (e.g. hundreds of instanced creatures chasing someone in a school cafeteria).
  - An authority figure's ridiculous coping device; pets or guards doing absurd jobs. Each gag <= 2.5s.
- **23%–35%: PROTAGONIST + BEST FRIEND**
  - First-person credentials.
  - Named best friend with 3 concrete quirks, each accompanied by its own 1.5–2.0s visual in a cozy interior.
- **35%–50%: INCITING INCIDENT**
  - Environment and color grade flip (bright primary -> desaturated storm/dark).
  - Friend goes missing; authority figure says nothing can be done.
- **50%–62%: RULE-OF-THREE ESCALATING ATTEMPTS**
  - The narrator uses the world rule as a tool.
  - Same shot setup each time, escalating numbers (1, 10, 100), each failing visually and comically.
- **62%–72%: EMOTIONAL REVEAL**
  - The one vulnerable truth the narrator has never told anyone.
  - Deliberate pause <= 0.6s, dramatic camera push-in, ground shake, huge effect (scale x10).
- **72%–90%: PAYOFF**
  - Dynamic tracking shot while riding the huge effect.
  - Discover the friend (close-up, weak/cold).
  - The effect delivers the confession publicly for everyone to hear.
- **90%–96%: MIRRORED PAYOFF**
  - Friend's counter-confession lands (a second big effect running in the opposite direction).
  - They travel home side by side in the restored bright primary color palette.
- **96%–100%: BUTTON GAG**
  - A pet or bystander reacts (faints).
  - A punchy one-line pun echoing the opening world rule.

---

## 4. Visual Language
- **Avatars**:
  - Blocky humanoid geometry with rounded-box limbs.
  - Detailed procedural clothing textures: graphic tees, plaid shirts, hoodies with kangaroo pockets, jackets with star/swirl emblems, denim jeans with visible seams, uniforms.
  - Hair kits: messy hair, curly hair, top bun, slicked back, baseball cap, fire helmet, bald.
  - Facial canvas textures: dot eyes, huge shock ring eyes, icy star eyes with tears, X eyes (fainted), smug troll grin, small "o" mouth, flat mouth, wide scream mouth.
  - Micro-animations: breathing torso scaling, idle blinking, dynamic head-turn tracking, lip-flap driven strictly by speech envelope.
- **Creatures & Animals**:
  - Cat archetype: white cube body with pink triangular ears.
  - Mouse archetype: grey block body with pink ears and tail.
  - Huge variants: x10 scale multiplier.
  - Instanced swarms: >= 300 animated instanced entities.
- **Environments**:
  - Low-poly primitive architecture.
  - Sunny Town: vivid blue sky, flat bright-green baseplate, round sphere trees, colorful box houses, white picket fences.
  - School Cafeteria: white walls, fluorescent ceiling light fixtures, wooden benches/tables, grey linoleum floor, chalkboard.
  - Bedroom: beige walls, wooden wardrobe with hanging clothes, bed with quilt, wooden table, reading lamp.
  - Winter Storm: white-blue dense fog, snow particle storm, snowbanks, evergreen pines.
  - Status Family additions: mansion dais, sunken pit, garage office, wedding hall.
  - Contrast rule: characters must always maintain high luminance contrast against backgrounds (never dark-on-dark).
- **FX**:
  - Puffs: clusters of white expanding spheres that shrink and fade out.
  - Snow particles, ground dust/shake, sparkles, ice encasing, smoke clouds.
- **Cinematography & Camera Grammar**:
  - Shot presets: `extreme_closeup`, `closeup`, `medium`, `two_shot`, `over_shoulder`, `wide`, `ground_low`, `top_down`, `tracking_behind`, `tracking_side`.
  - Camera moves: `push_in`, `pull_out`, `whip_pan`, `shake`, `orbit`, `dolly`.
  - Max hold: no shot held longer than 3.0s.
  - Auto-framing: adjusts camera pitch/height so character faces never enter the top 12%–20% caption band.

---

## 5. Caption Specification ("reference_caps")
- **Typography**: White bold rounded sans-serif with strong soft black shadow/outline.
- **Container**: NO background box or pill.
- **Positioning**: Centered horizontally, top 12%–20% vertically.
- **Card Chunking**: 2–4 words per card (duration ~0.75s).
- **Word Formatting**: Exactly ONE (or at most two) key punchline noun/verb per card in ALL CAPS; all other words in sentence case.
- **Timing Continuity**: Each card spans from the start of its first word to the start of the next card's first word. Zero silent gaps; zero stale reappearing cards.

---

## 6. Audio Design & SFX
- **Voiceover**: Continuous narration at 3.0–4.0 words/s (sentence-level crossfaded joins, pause <= 0.2s).
- **SFX**: Layered on EVERY visual event (poof, pop, whoosh, scurry, gasp, rumble, ice_crack, ding, womp, footsteps, wind_loop, room_tone_loop, crowd_murmur_loop).
- **Ambience**: Per-environment ambient loop ducked under narration.
- **Mastering**: -14 LUFS (±1.0), true peak <= -1.0 dBFS. No silent frames in audio track.
