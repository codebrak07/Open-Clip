import fs from 'fs';
import path from 'path';
import { OrpheusVoiceSynthesizer } from '../src/core/story/audio/OrpheusVoiceSynthesizer';
import { ProceduralSfxSynth } from '../src/core/story/sfx/ProceduralSfxSynth';
import { SfxIndexer } from '../src/core/story/sfx/SfxIndexer';
import { WhisperAlignmentEngine } from '../src/core/story/audio/WhisperAlignmentEngine';
import { AudioMixEngine } from '../src/core/story/audio/AudioMixEngine';

describe('Story Studio - Milestone 2 Specification Tests (Audio, TTS, Alignment, SFX Mix)', () => {
  const testOutputDir = path.resolve(__dirname, '../storage/test_m2');

  beforeAll(() => {
    fs.mkdirSync(testOutputDir, { recursive: true });
  });

  describe('1. Orpheus Voice Synthesizer & Chunker (<=200 char limit)', () => {
    it('should split long dialogue lines into chunks strictly <= 200 characters including direction tags', () => {
      const longText =
        'This is a really long and dramatic sentence that goes on and on to test if the OpenClip Orpheus voice chunking mechanism properly respects the hard limit of two hundred characters per request without truncating words or losing context. Furthermore, we add a second sentence here to verify clause and sentence boundary detection!';
      const tag = 'dramatic';
      const chunks = OrpheusVoiceSynthesizer.splitIntoChunks(longText, tag, 200);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(200);
        expect(chunk.startsWith('[dramatic]')).toBe(true);
      }
    });

    it('should pack and extract PCM data from standard 44-byte WAV header correctly', () => {
      const sampleRate = 24000;
      const numChannels = 1;
      const dummyPcm = Buffer.alloc(4800); // 0.1s of 16-bit mono PCM
      dummyPcm.fill(0x55);

      const wav = OrpheusVoiceSynthesizer.createWavFile(dummyPcm, sampleRate, numChannels, 16);
      expect(wav.length).toBe(4800 + 44);
      expect(wav.toString('utf8', 0, 4)).toBe('RIFF');
      expect(wav.toString('utf8', 8, 12)).toBe('WAVE');

      const extracted = OrpheusVoiceSynthesizer.extractPcmFromWav(wav);
      expect(extracted.sampleRate).toBe(sampleRate);
      expect(extracted.numChannels).toBe(numChannels);
      expect(extracted.pcm.length).toBe(4800);
      expect(extracted.pcm.equals(dummyPcm)).toBe(true);
    });
  });

  describe('2. Procedural SFX Synthesizer (13 catalog cues)', () => {
    let synth: ProceduralSfxSynth;

    beforeAll(() => {
      synth = new ProceduralSfxSynth(path.join(testOutputDir, 'sfx'));
    });

    const expectedCues = [
      'whoosh', 'poof', 'boom', 'riser', 'impact', 'ice_crack',
      'pop', 'bonk', 'sparkle', 'record_scratch', 'footsteps',
      'wind_loop', 'room_tone_loop'
    ];

    it.each(expectedCues)('should synthesize valid 44.1kHz 16-bit mono WAV for cue: %s', (cue) => {
      const res = synth.generate(cue);
      expect(res.cue).toBe(cue);
      expect(res.durationSec).toBeGreaterThan(0.1);
      expect(fs.existsSync(res.wavPath)).toBe(true);

      const info = OrpheusVoiceSynthesizer.extractPcmFromWav(res.wavBuffer);
      expect(info.sampleRate).toBe(44100);
      expect(info.numChannels).toBe(1);
      expect(info.pcm.length).toBeGreaterThan(1000);
    });
  });

  describe('3. SFX Indexer & Auto-Resolution', () => {
    it('should index existing SFX and procedurally resolve any missing catalog cue', () => {
      const indexer = new SfxIndexer(path.join(testOutputDir, 'indexer_sfx'));
      const entry = indexer.resolveCue('bonk');
      expect(entry).toBeDefined();
      expect(entry.cue).toBe('bonk');
      expect(fs.existsSync(entry.path)).toBe(true);
      expect(entry.durationSec).toBeGreaterThan(0.1);
    });
  });

  describe('4. Word Alignment & Timeline Anchoring', () => {
    it('should anchor actions, shots, and SFX to word timestamps on a continuous timeline', () => {
      const engine = new WhisperAlignmentEngine();
      const mockBeats = [
        {
          id: 'b1',
          speaker: 'char_1',
          text: 'Wait for it!',
          shot: { type: 'medium', target: 'char_1', move: 'static' },
          actions: [{ actor: 'char_1', anim: 'point', expression: 'surprised', atWord: 1 }],
          fx: [{ type: 'exclamation', atWord: 2 }],
          sfx: [{ cue: 'riser', atWord: 0, gainDb: -2 }],
        },
        {
          id: 'b2',
          speaker: 'char_1',
          text: 'Boom! We got it!',
          shot: { type: 'close_up', target: 'char_1', move: 'dolly_in' },
          actions: [{ actor: 'char_1', anim: 'celebrate', expression: 'happy', atWord: 0 }],
          fx: [{ type: 'confetti', atWord: 0 }],
          sfx: [{ cue: 'boom', atWord: 0, gainDb: 0 }],
        },
      ];

      const mockWordsBeat1 = [
        { word: 'Wait', start: 0.1, end: 0.4 },
        { word: 'for', start: 0.45, end: 0.65 },
        { word: 'it', start: 0.7, end: 0.9 },
      ];

      const mockWordsBeat2 = [
        { word: 'Boom', start: 0.05, end: 0.4 },
        { word: 'We', start: 0.45, end: 0.6 },
        { word: 'got', start: 0.65, end: 0.8 },
        { word: 'it', start: 0.85, end: 1.0 },
      ];

      const aligned = engine.mapBeatsToTimeline(mockBeats, [mockWordsBeat1, mockWordsBeat2], [1.0, 1.2]);

      expect(aligned.length).toBe(2);
      expect(aligned[0].startSec).toBe(0.0);
      expect(aligned[0].actions[0].startSec).toBe(0.45); // atWord 1 ('for')
      expect(aligned[0].fx[0].startSec).toBe(0.7); // atWord 2 ('it')

      // Beat 2 starts after Beat 1 (1.0s + 0.15s buffer = 1.15s)
      expect(aligned[1].startSec).toBe(1.15);
      expect(aligned[1].words[0].start).toBe(1.2); // 1.15 + 0.05
      expect(aligned[1].sfx[0].startSec).toBe(1.2);
    });
  });

  describe('5. Audio Mixing Engine (FFmpeg Sidechain Ducking, Limiter, Loudnorm)', () => {
    it('should generate valid FFmpeg filtergraph with sidechaincompress, alimiter, and loudnorm', () => {
      const mixEngine = new AudioMixEngine();
      const fg = mixEngine.buildFilterGraph(2, true);

      expect(fg.filterComplex).toContain('asplit=2[vo_main][vo_sc]');
      expect(fg.filterComplex).toContain('sidechaincompress=threshold=0.08:ratio=4:attack=50:release=300');
      expect(fg.filterComplex).toContain('alimiter=limit=-6dB');
      expect(fg.filterComplex).toContain('loudnorm=I=-14:LRA=11:TP=-1.5');
    });

    it('should execute end-to-end audio mix with dummy voiceover and procedural SFX', async () => {
      const mixEngine = new AudioMixEngine();
      const synth = new ProceduralSfxSynth(path.join(testOutputDir, 'sfx'));

      // 1. Generate short dummy voiceover WAV (1.5 seconds)
      const voPcm = Buffer.alloc(24000 * 2 * 1.5);
      // Generate simple low sine tone
      for (let i = 0; i < 24000 * 1.5; i++) {
        const val = Math.floor(Math.sin(2 * Math.PI * 300 * (i / 24000)) * 10000);
        voPcm.writeInt16LE(val, i * 2);
      }
      const voWav = OrpheusVoiceSynthesizer.createWavFile(voPcm, 24000, 1, 16);
      const voPath = path.join(testOutputDir, 'test_vo.wav');
      fs.writeFileSync(voPath, voWav);

      // 2. Generate two SFX cues
      const sfxWhoosh = synth.generate('whoosh');
      const sfxBoom = synth.generate('boom');

      // 3. Mixdown into output
      const mixedPath = path.join(testOutputDir, 'test_master_mix.wav');
      await mixEngine.mixAudio({
        voiceoverWavPath: voPath,
        sfxItems: [
          { cue: 'whoosh', filePath: sfxWhoosh.wavPath, startSec: 0.2, gainDb: -2 },
          { cue: 'boom', filePath: sfxBoom.wavPath, startSec: 0.8, gainDb: -1 },
        ],
        outputPath: mixedPath,
        targetDurationSec: 1.5,
      });

      expect(fs.existsSync(mixedPath)).toBe(true);
      const stat = fs.statSync(mixedPath);
      expect(stat.size).toBeGreaterThan(10000); // Valid audio file output
    });
  });

  describe('6. Reference Caps Caption Engine & Stale-Card Regression', () => {
    it('should generate reference_caps subtitles with rounded bold font, shadow, and no background box', () => {
      const { StoryPopCaptionEngine } = require('../src/core/story/captions/StoryPopCaptionEngine');
      const mockAlignedBeats = [
        {
          id: 'b1',
          speaker: 'narrator',
          text: 'In this world, cats sneeze smoke whenever you lie.',
          words: [
            { word: 'In', start: 0.1, end: 0.3 },
            { word: 'this', start: 0.35, end: 0.55 },
            { word: 'world', start: 0.6, end: 0.9 },
            { word: 'cats', start: 1.0, end: 1.25 },
            { word: 'sneeze', start: 1.3, end: 1.6 },
            { word: 'smoke', start: 1.65, end: 2.0 },
            { word: 'whenever', start: 2.1, end: 2.4 },
            { word: 'you', start: 2.45, end: 2.65 },
            { word: 'lie', start: 2.7, end: 3.0 },
          ],
          emphasisWords: ['smoke', 'lie'],
        },
      ];

      const assPath = path.join(testOutputDir, 'test_ref_caps.ass');
      StoryPopCaptionEngine.generateAssSubtitles(mockAlignedBeats, assPath, 1080, 1920);

      expect(fs.existsSync(assPath)).toBe(true);
      const content = fs.readFileSync(assPath, 'utf-8');

      // Style verification
      expect(content).toContain('Style: ReferenceCaps,Arial Rounded MT Bold');
      expect(content).toContain('&H00FFFFFF'); // White text
      expect(content).toContain('&H80000000'); // Soft shadow

      // Ensure 2-4 words per card
      const dialogues = content.split('\n').filter(l => l.startsWith('Dialogue:'));
      expect(dialogues.length).toBeGreaterThanOrEqual(3);

      for (const d of dialogues) {
        const text = d.split(',').slice(9).join(',');
        const words = text.trim().split(/\s+/);
        expect(words.length).toBeGreaterThanOrEqual(2);
        expect(words.length).toBeLessThanOrEqual(4);

        // Verify exactly one or at most two words in ALL CAPS (emphasis word)
        const capsWords = words.filter(w => w === w.toUpperCase() && w.length > 1);
        expect(capsWords.length).toBeGreaterThanOrEqual(1);
        expect(capsWords.length).toBeLessThanOrEqual(2);
      }
    });

    it('stale-card regression test: timeline with 1s gaps has zero stale or reappearing cards', () => {
      const { StoryPopCaptionEngine } = require('../src/core/story/captions/StoryPopCaptionEngine');
      const timelineWithGaps = [
        {
          id: 'beat_0',
          speaker: 'narrator',
          text: 'Opening hook rule starts here.',
          words: [
            { word: 'Opening', start: 0.2, end: 0.5 },
            { word: 'hook', start: 0.55, end: 0.8 },
            { word: 'rule', start: 0.85, end: 1.1 },
            { word: 'starts', start: 1.15, end: 1.4 },
            { word: 'here', start: 1.45, end: 1.7 },
          ],
        },
        // 1.0 second silent gap between beat_0 (ends at 1.7s) and beat_1 (starts at 2.7s)
        {
          id: 'beat_1',
          speaker: 'narrator',
          text: 'Second beat arrives after gap.',
          words: [
            { word: 'Second', start: 2.7, end: 3.0 },
            { word: 'beat', start: 3.05, end: 3.3 },
            { word: 'arrives', start: 3.35, end: 3.6 },
            { word: 'after', start: 3.65, end: 3.9 },
            { word: 'gap', start: 3.95, end: 4.2 },
          ],
        },
      ];

      const assPath = path.join(testOutputDir, 'test_stale_regression.ass');
      StoryPopCaptionEngine.generateAssSubtitles(timelineWithGaps, assPath, 1080, 1920);

      const content = fs.readFileSync(assPath, 'utf-8');
      const dialogues = content.split('\n').filter(l => l.startsWith('Dialogue:'));

      // Verify that no card from beat 0 overlaps or reappears at beat 1 start (2.7s)
      for (const d of dialogues) {
        const parts = d.split(',');
        const startSecStr = parts[1];
        const endSecStr = parts[2];
        const text = d.split(',,')[1];

        // If card is from beat 0, it must end before or at beat 1's arrival (2.7s)
        if (text.includes('hook') || text.includes('Opening')) {
          expect(endSecStr <= '0:00:02.70').toBe(true);
        }
      }
    });
  });
});
