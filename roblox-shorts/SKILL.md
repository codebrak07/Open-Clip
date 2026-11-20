---
name: roblox-shorts
description: Use when someone asks to make a Roblox short, a Roblox story video, an "In this town" video, a blocky game-world story short for YouTube Shorts, TikTok or Reels, or says "make me a roblox story". Also use to set up, voice, preview, fix or re-render one of these videos, or to help get a Fish Audio or ElevenLabs key for the voice. Version 3.
---

# Roblox shorts (version 3)

A vertical story short in a blocky game world: block avatars with pixel faces that lip-sync, a world that is different every time (suburb, meadow, town square, shop street, rooms, or a place built from a free 3D kit), people walking and cars driving, word captions, a kid's voice, music and sound effects. Everything is drawn in code by the three.js engine in `template/`. The person needs no Roblox Studio, no Blender and no coding.

This skill is complete on its own: it sets up everything it needs, it does the voice itself (`voice.mjs`) and it renders itself (`render.mjs`). Never search a marketplace, install other skills or use the computer's built-in voices for it.

The person only makes choices. You run every command and write every file. Explain in plain words, never show code unless asked. Never ask the person to paste a key into the chat.

## The flow

Do the steps in order. A step marked **STOP** ends your turn: show the thing, ask, and wait. If the person already gave a rule, a story or a script, skip to the step after it. If they say "just make it", pick your top idea and the default voice, and stop only at step 6.

| # | Step | The person gets | Stop? |
|---|---|---|---|
| 1 | Set up (first time only) | "Ready" | no |
| 2 | Story ideas | 10 ideas, your top 3 | **STOP: they pick one** |
| 3 | Script | the full script and its length | **STOP: they approve or edit** |
| 4 | Voice | one sample clip | **STOP: they approve the voice** |
| 5 | Plan | cast, places, moods in 5–8 lines | no |
| 6 | Build and check | a sheet of stills | **STOP: they approve the look** |
| 7 | Render | the video file | **STOP: what to change?** |

### 1. Set up (first time only)

The workspace is the folder `roblox-shorts` in the person's home folder (`~/roblox-shorts` on Mac, `%USERPROFILE%\roblox-shorts` on Windows). If it already has `node_modules` and `setup.mjs`, skip to step 2.

1. **Node.js.** Run this skill's Node check, which installs Node.js for this user only when the computer has none (no admin needed):
   - Mac or Linux: `bash <this skill>/template/install/node.sh`
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <this skill>\template\install\node.ps1`

   Its last line is `NODE=<path>`. Use that path as `node` (and the `npm` next to it) for every command in this skill. A line starting with `FAILED:` says what to tell the person.
2. Copy everything inside this skill's `template/` folder into the workspace. Never copy over a file that is already there (the person's `.env`, `history.json` and finished videos stay).
3. In the workspace run `node setup.mjs`. It installs three.js, a browser for drawing the frames, ffmpeg and the free voice (a few minutes and about 400 MB the first time), draws one test picture and prints `READY`. A line starting with `FAIL` says what to do.
4. **The voice key.** Ask which voice they'll use: ElevenLabs (free plan, its own voices), Fish Audio's "Roblox rant" (by hand on a free account, or automatic with an API key that has credit), or both. Every route except the plain free voice needs an ElevenLabs key: Fish gives no word times and the skill gets them from ElevenLabs. If `node voice.mjs check` shows no key: create `.env` in the workspace and open it for them (Mac: `touch ~/roblox-shorts/.env && open -e ~/roblox-shorts/.env`; Windows: `notepad %USERPROFILE%\roblox-shorts\.env`), tell them to put one line `ELEVENLABS_API_KEY=<their key>` (and `FISH_AUDIO_API_KEY=<key>` if they have Fish credit), save, and say "done". Never ask for the key in the chat. If they have no key yet, walk them through **Getting a voice key** below. Run `check` again and confirm it says `set`.
5. Tell the person "Ready".

**One video at a time.** The video is built in the workspace itself (`story.json`, `voice/`, `scenes/<name>.js`, `stills/`, `out/`). Before starting a new story when the workspace already has one, move that video's `story.json`, `voice/`, `out/`, `stills/` and its scene file into `done/<its short name>/`, and put back the template's example `story.json`.

### 2. Story ideas (STOP)

If the `roblox-story` skill is installed, follow it for steps 2 and 3. If not, read `script.md` here (section 0 decides whose story it is). **A script the person brought is voiced word for word**: only split it into lines, suggest at most 3 changes and make none without a yes. With nothing given, show 10 ideas as a table (the opening line, what you see, who it is about, the last line, which shape) across at least 3 of the five shapes in `script.md`, mark your top 3 with one line each on why, and ask which one. Offer "or tell me your own story". `examples.md` has finished scripts; never reuse them.

### 3. Script (STOP)

Write it for the length they want (default 60 s; words = seconds × 4.3). Show plain lines with the title and the word count, and ask: "Change anything, or shall I voice it?"

### 4. Voice (STOP)

Write `story.json` in the workspace: copy the shape of the template's `story.json`, one beat per sentence or phrase, every beat `"style": "town"`, without the `"example"` and `"seconds"` fields.

1. Run `node voice.mjs check`. It says which voices are ready (it never prints keys).
2. **Pick the voice:**
   - **Fish Audio key set:** Fish, with the "Roblox Rant" kid voice (the voice these shorts are known for; it is the default).
   - **Else ElevenLabs key set:** ElevenLabs, with the voice in `story.json` `"voice"` or the skill's default.
   - **Fish by hand (a free Fish account, no API credit):** the person wants the "Roblox Rant" voice but has no Fish credit. Run `node voice.mjs chunks`: it splits the script into pieces of 500 characters or less (whole lines) and prints them. Walk the person through it: open https://fish.audio/m/e0fbbf9e5123434fb77c7a7eeaacb312 (the "Roblox rant" voice) → **Use Voice** → paste piece 1 exactly as printed (the `[long pause]` tags make the gaps between lines) → **Generate Speech** → **Download** (an upgrade pop-up may appear: close it, the file still downloads); then piece 2, and so on, in order. The files land in their Downloads folder: leave them there. Right after showing the pieces, run `node voice.mjs import --wait` (add `--speed 1.1` if it sounds slow) and let it run: it watches Downloads and carries on by itself once every piece is downloaded, so the person never has to say "done". It cuts every piece into its lines and writes the same files as `make`. **Word timing:** Fish gives none. With an ElevenLabs key that has "Forced Alignment" access, `import` gets the exact time of every word from ElevenLabs (free plan works); without it, the lines are cut at the long pauses and word times are estimated (captions can drift a little inside a line). Skip steps 3–4 below; give them `voice/voice.mp3` to listen to. If a line starts in the wrong place, have them generate that piece again.
   - **Else the free voice** (no account, no key). Say once: "The free voice works right now. If you want the voice these shorts are known for, I can help you get a Fish Audio key (or an ElevenLabs key) in two minutes." If they want a key, walk them through **Getting a voice key** below, one step at a time, then run `check` again.
3. `node voice.mjs sample --text "<the first two sentences>"` and give them the file to listen to. Wait for an OK.
4. `node voice.mjs make --pause 0.08`, then read the words a minute it prints. The target is the story shape's pace in `script.md` (240–270 for the default shape). Too slow: add `--speed 1.05` up to `1.3` and run again; too fast: lower it. In range, leave it. Fish takes vary, so check every time. `make` also writes `voice/mouth.json` (the lip-sync); after any re-voice run `node mouth.mjs` too.

### 5. Plan (no stop)

Tell the person in 5–8 lines, then build without waiting:
- **The cast:** each character's look in a few words (skin, top, trousers, hair, size). Every character gets one strong colour. Never the example's kids or outfits.
- **The places:** run `node render.mjs history` to see recent videos. Give every line a place the story asks for. Build each one, in this order:
  1. **A kit** (`kit:<kit-id>`): `node pf.mjs kits <words>` lists Polyfork's ~55 free themed kits (hospital, cafe, school, farm, campground, coast, airport, stadium, pirate cove, medieval village, little tokyo, new york city...). `node pf.mjs place <kit-id>` fetches it; `kitPlace({ kit, mode: 'room' | 'yard', seed })` builds it (api.md, "Places from kits").
  2. **A world** (`world:<kind>`): `suburb`, `meadow`, `plaza` or `city`, with the story's own houses and cars.
  3. **A room** (`room:<kind>`): `living`, `classroom`, `diner`, `library`, `bedroom`.
  4. **By hand** (`hand`, with a `why`): only for what nothing else has.
  Write the plan into `story.json` `"places"` (api.md, "The place plan"). Pick a theme (`sunny`, `pastel`, `autumn`, `snow`, `night`) and a seed the history doesn't show.
- **Effects, line by line:** name what each line shows happening and the engine tool for it: something appearing or turning real → `d.appear` (sparkles); vanishing → `d.vanish`; a crash or a hit → `d.knock` + `d.shake`; magic, music, a bird → `d.burst('sparkle' | 'notes' | 'feathers')`; a note, a sign or a clock the story mentions → `d.insert`; **only when the story is about drawing** (a drawing comes to life, a kid sketches something) → `sketchbook`/`drawOn` (never add a drawing to a story that doesn't have one); someone in the air → `d.fall`/`d.jump`; a car → `d.drive`. Use an effect where the line really has an event (most lines do), never one that doesn't fit the story. Dust on landings, take-offs, hits and braking comes by itself.
- **Moods:** which shots go `night`, `danger`, `memory`, `warm` or `cold`.
- **The models:** every thing a line names (a sheep, a bus, a locker) is a real free model: from the place's kit, or `node pf.mjs search <words>` then `node pf.mjs get <id>...` (api.md, "Real models"). List them in the place's `"models"`.

### 6. Build and check (STOP)

Write `scenes/<name>.js`. Read `look.md` (shot rules) and `api.md` (what you can call) first, and start from `scenes/example-game.js` (the game layer, shot presets, effects) and `scenes/balloons.js` for the pattern: the world is built once in `create`, and `update` has one block per line with 2–3 sub-shots cut on spoken words. Copy its helpers, never its story, cast or places. Point every beat's `"scene"` at your file.

1. `node render.mjs check` lists the lines and their timing.
2. `node render.mjs stills <t1,t2,...>` with 3 times per line (near the start, middle and end, in seconds of the whole video). Read `stills/sheet.jpg` yourself and fix what's wrong before showing it:
   - every face readable, nothing cut off, nobody hidden behind a prop or a caption (the bottom third is for captions)
   - the thing each line talks about is in the picture, and every action it names is visible
   - a `CLIP` line means something passes through something: change the pose or move people at least 4.4 studs apart
   - nobody walks backward or on the spot, nobody stands inside a hedge, fence, wall or prop, no car touches a car or a person, nothing stands between the camera and the subject
   - **nobody is stuck:** compare stills a second apart; a falling, flying or walking character must be somewhere else in each one (look.md, "Falls, jumps, flights"). Sample 3–4 stills inside every action, not only one per line.
3. Show the person the sheet and ask what to change. Change only what they name, then make stills for those lines again.

### 7. Render (STOP)

`node render.mjs video`. It refuses while any frame has a `CLIP` problem and prints `CLIP at <time> (beat N): …`: fix those and run it again. Give the person `out/video.mp4` (the full path) and ask what to change. To change one part, edit only that line's block and render again. You can't see motion or hear sound: tell them to watch and listen once.

Optional live view: `node render.mjs preview` (start it in the background); the person opens the printed address and clicks to play with sound.

## Getting a voice key

Keys live in a file named `.env` in the workspace folder, one per line. Create the file for the person (`touch ~/roblox-shorts/.env` then `open -e ~/roblox-shorts/.env` on Mac; on Windows `notepad %USERPROFILE%\roblox-shorts\.env`), and tell them to paste the line, save and close it. **Never ask them to paste a key into the chat.** Then run `node voice.mjs check` to confirm it says `set`.

**Fish Audio** (the "Roblox Rant" voice these shorts are known for). A free Fish account works **by hand** (step 4, "Fish by hand": about 7 minutes of speech a month, personal use). For the skill to do it automatically, the API needs credit:
1. Go to https://fish.audio and sign up (Google sign-in works).
2. Open https://fish.audio/app/api-keys and click **Create** (or **New API Key**). Copy the key.
3. Fish charges per use: add a little credit on the billing page if the account has none (a short costs cents).
4. In `.env` add: `FISH_AUDIO_API_KEY=<the key>`

**ElevenLabs:**
1. Go to https://elevenlabs.io and sign up (the free plan works for testing).
2. In the left menu, **Developers** → **API Keys** → **Create Key**. Name it, then set **Text to Speech: Access**, **Voices: Write**, **Voice Generation: Access** and **Forced Alignment: Access** (the exact word times for a Fish voice made by hand). Everything else stays No Access. **Create Key**, then **Copy**.
3. In `.env` add: `ELEVENLABS_API_KEY=<the key>`

If both are set, Fish is used unless `story.json` says `"voice": { "provider": "elevenlabs", "id": "<voice id>" }`.

**The "Roblox Rant" voice on ElevenLabs (a clone):** the free ElevenLabs plan can't use shared voices, so the raw voice
file is in the Discord (#free-skills). With an ElevenLabs plan that allows Instant Voice Clone:
1. ElevenLabs → **Voices** → **Create a voice** → **Instant Voice Clone**, upload the raw voice file, tick that you have the
   right to use it (the voice's maker allows it), name it "Roblox Rant", save.
2. Open the new voice, copy its **Voice ID**.
3. Put it in `story.json`: `"voice": { "provider": "elevenlabs", "id": "<that id>" }`.

**Voice errors:** `NO_KEY` or `AUTH_FAILED`: the key is missing or wrong; make a new one. `OUT_OF_CREDITS` (or HTTP 402/429 about quota): the plan is out of characters or credit; say so plainly and offer the free voice or the other provider.

## Rules that don't bend

- **Stop at every STOP.** No voice credits and no build time on a story the person hasn't approved.
- **The person's own script is never rewritten** without their yes.
- **Every video is new:** new rule, new names, new cast, new places, a new theme or seed. The place plan and `history.json` enforce it; never work round a refusal by renaming a place or faking `"repeat"`.
- **Never turn off the frame check** or hide a character from it to get a render through. Fix the pose.
- **Nothing passes through anything.** Parked cars stay in the parking lanes (x 5.3 and 15.7, away from z 0); driven cars use the middle lanes (one lane at x 10.5 with Polyfork cars; otherwise x 9 and 12.2). Two people side by side stand 4.4 studs apart or more. People stand on open ground; someone meant to lean on or sit in something sets `c.touching = true` for that frame.
- **Extras and traffic come from `life()`** (NPCs walk clear lanes, cars drive spaced in one lane). Never hand-place extras on lawns or by hedges.
- **Walking moves people:** `d.walk(...)` in a straight line, `d.walkTo(...)` whenever something stands in the way; never `c.walk()` alone (that is a moonwalk).
- **Frame people with `d.shot(...)`** (face, medium, wide, low, top, ots, two); the framing check refuses a speaker out of frame or an empty shot (`d.allowEmpty()` for a shot of a thing).
- **Use the game layer, it's what makes it look like the game:** `d.walkTo` when someone goes somewhere, `d.jump`/`d.fall` for anything in the air, `d.appear`/`d.vanish` + `d.burst` for magic, `d.drive` for cars, `d.knock` for things hit, `d.insert` for a clock or a note. `scenes/example-game.js` shows each one; copy the patterns, never the story.
- **Falls and jumps use the engine:** `d.fall(...)` and `d.jump(...)` (real arcs that land on the true surface). Never animate a fall by hand.
- **`MOVED:` lines after `stills`** mean someone was placed inside a prop: fix their spot in the scene.
- **Things move like things:** a door swings on its hinge, a car drives or brakes to a stop, nothing appears out of nowhere inside a shot.
- **The camera never sits behind a prop.**
- **Sound effects** follow look.md (Sound): one sound per thing that appears, a whoosh only on a change of place, never louder than the voice. Read `out/sfx-plan.json` after every render.
- **Safe for kids:** no one is hurt on screen, no swearing, no real brands or real people on signs or in captions.
- **Say what you checked.** You see stills, not motion or sound.

## Settings in story.json

`"captions": false` (the scene draws the captions in this look), `"keys": [...]` (coloured key words: the rule's thing, names, counted numbers), `"caption"` for another caption style (api.md). Music: `"music": "audio/bg.mp3"`, `"musicVolume": 0.12`, `"sound": { "bed": "none", "music": -14 }`; no music: `"music": null` and `"sound": { "bed": "none", "music": false }`. Sound effects are automatic; `"sfx": false` turns them off. Voice: `"voice": { "provider": "fish" | "elevenlabs" | "free", "id": "<voice id>" }`.

## Files

- `script.md`: how to write the story (five shapes). `examples.md`: finished scripts.
- `look.md`: pacing, shots, acting, captions and sound, measured from viral shorts.
- `api.md`: characters, faces, lip-sync, worlds, kits, models, light, camera, captions, the frame check.
- `template/`: the workspace: `setup.mjs`, `voice.mjs`, `mouth.mjs`, `render.mjs`, `pf.mjs`, the engine, `lib/blocky/`, music and sound effects, textures, fonts, the example `scenes/balloons.js` + `story.json`, `install/node.sh|ps1`.

## When something fails

- `Missing packages` or a module not found: run `node setup.mjs` again in the workspace.
- `voice/timing.json has N lines but story.json has M beats`: the lines changed after voicing; run `node voice.mjs make` again.
- `Failed to fetch dynamically imported module`: a beat names a scene file that doesn't exist.
- Very slow or black 3D frames on Linux or an old PC: it works, just slower; keep the video short.
- **`npm install did not finish` / `ENOTFOUND` / `ECONNRESET`:** a dropped connection. `setup.mjs` already retries 3 times; if it still fails, check the internet and run `node setup.mjs` again.
- **`FAIL: the rendering browser could not start`:** run `node setup.mjs` (it installs the browser), then the same command again.
- **`net::ERR_ABORTED` or `FAIL: the renderer could not open its local page`** (Windows): a firewall or antivirus is blocking Node.js from talking to this computer. The render already retries 3 times. Tell the person: allow Node.js through Windows Firewall / their antivirus (it only talks to 127.0.0.1), then run the same command again.
- **Stills work but the video doesn't:** read the `CLIP`, `FRAME`, `BIG` and `ISSUE` lines it prints, fix those shots, make stills of them again, then the video.
- **`ElevenLabs alignment not used: HTTP 401`:** the ElevenLabs key has no "Forced Alignment" access. The voice still works (lines are cut at the pauses); for exact word times, make a key with Forced Alignment on (Getting a voice key).
- **`OUT_OF_CREDITS`, an upgrade pop-up on fish.audio, or HTTP 402/429:** the voice account is out of credit or free minutes. Say so plainly and offer: the other provider, Fish by hand on another free account, or the free voice.
- **`NO_FILES` (Fish by hand):** the pieces weren't downloaded yet, or the browser saves somewhere else: put them in `voice/fish/` (any names, any order of download is fine as long as piece 1 was downloaded first), then run `node voice.mjs import`.
- **`PLACES: ... same as` / `REFUSED: fix the place plan`:** this video repeats a recent one. Pick another world kind, theme, seed or kit (never rename to dodge it).
- **The agent tool says "Our servers are experiencing high traffic" (Antigravity):** that is the tool's server, not this skill. Wait a minute and say "continue"; nothing is lost.
- **Windows: "Do you want to create this file?" when the `.env` opens in Notepad:** click Yes.
