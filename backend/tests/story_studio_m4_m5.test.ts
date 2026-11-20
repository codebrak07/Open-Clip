import { LeakageValidator } from '../src/core/story/satire/LeakageValidator';
import { TimelineAutoFixer } from '../src/core/story/satire/TimelineAutoFixer';
import { ConceptStage } from '../src/core/story/satire/ConceptStage';
import { QualityGovernor } from '../src/core/story/renderer/QualityGovernor';

describe('Story Studio - Milestone 4 & 5 (Concept Engine, Leakage Test, Timeline Auto-Fix, Quality Governor)', () => {
  describe('1. Few-Shot Leakage Rejection Test', () => {
    it('should reject a script draft that directly copies few-shot reference phrases (> 12% 4-gram overlap)', () => {
      const verbatimLeakedText =
        'In this world, JEE rank floats above everyones head. AIR 1 lives in a mansion while the mayor rank 750000 lives in a garage and runs the town from it at his own wedding the low rank groom stands in a pit.';
      const result = LeakageValidator.checkLeakage(verbatimLeakedText, 0.12);
      expect(result.passed).toBe(false);
      expect(result.overlapRatio).toBeGreaterThan(0.12);
      expect(result.matchedNgrams.length).toBeGreaterThan(0);
    });

    it('should pass an original creative satire script (<= 12% 4-gram overlap)', () => {
      const originalScript =
        'In this school, unread notification counts hover over every desk in shimmering neon digits. ' +
        'Students with zero pings enjoy silent personal meditation bubbles, while the principal is swarmed by ninety thousand buzzing alerts. ' +
        'My best friend Toby attempts to foil the sensor by wrapping his backpack in heavy duty foil.';
      const result = LeakageValidator.checkLeakage(originalScript, 0.12);
      expect(result.passed).toBe(true);
      expect(result.overlapRatio).toBeLessThanOrEqual(0.12);
    });

    it('should sanitize leaked keywords from text', () => {
      const textWithTerms = 'The winner is AIR 1 while AIR 7,50,000 stands below in the JEE rank hierarchy.';
      const sanitized = LeakageValidator.sanitizeLeakage(textWithTerms);
      expect(sanitized).not.toContain('AIR 1');
      expect(sanitized).not.toContain('JEE rank');
    });
  });

  describe('2. Concept Engine & Critic Selection', () => {
    it('should generate 3 distinct candidate concepts with quantitative critic scoring', async () => {
      const stage = new ConceptStage();
      const result = await stage.generateConcepts({ tag: 'Sleep debt hours', count: 3 });
      expect(result.concepts.length).toBeGreaterThanOrEqual(3);
      expect(result.selectedConcept).toBeDefined();
      expect(result.selectedConcept.openingLine).toMatch(/^In this/);
      expect(result.criticFeedback).toContain('Selected Candidate');
      expect(result.criticFeedback).toContain('Visual Disparity');
    });
  });

  describe('3. Pre-Render Timeline Parity & Auto-Fixer', () => {
    it('should detect deficiencies in raw storyboard (slow cuts, single environment, small cast)', () => {
      const slowStoryboard = {
        title: 'Slow Story',
        scenes: [{ id: 'sunny_town', location: 'sunny_town', beats: [] }],
        characters: [{ id: 'c1', name: 'Hero' }, { id: 'c2', name: 'Buddy' }],
      };
      const longHoldBeats = [
        {
          id: 'b1',
          speaker: 'c1',
          startSec: 0,
          endSec: 5.5, // > 3.0s hold
          text: 'One two three four five six seven eight nine ten words in beat',
          words: [
            { word: 'One', start: 0, end: 0.5 },
            { word: 'two', start: 0.5, end: 1.0 },
            { word: 'three', start: 1.0, end: 1.5 },
            { word: 'four', start: 1.5, end: 2.0 },
          ],
        },
      ];

      const audit = TimelineAutoFixer.auditTimeline(slowStoryboard, longHoldBeats);
      expect(audit.passed).toBe(false);
      expect(audit.warnings.some(w => w.includes('Max shot hold'))).toBe(true);
      expect(audit.warnings.some(w => w.includes('Low environment'))).toBe(true);
      expect(audit.warnings.some(w => w.includes('Low cast'))).toBe(true);
    });

    it('should auto-fix deficiencies: split long shots, populate cast and environments', () => {
      const slowStoryboard = {
        title: 'Deficient Story',
        scenes: [{ id: 'sunny_town', location: 'sunny_town', beats: [] }],
        characters: [{ id: 'c1', name: 'Hero' }, { id: 'c2', name: 'Buddy' }],
      };
      const longHoldBeats = [
        {
          id: 'b1',
          speaker: 'c1',
          startSec: 0,
          endSec: 4.8,
          text: 'One two three four five six seven eight',
          words: [
            { word: 'One', start: 0, end: 0.8 },
            { word: 'two', start: 0.8, end: 1.6 },
            { word: 'three', start: 1.6, end: 2.4 },
            { word: 'four', start: 2.4, end: 3.2 },
          ],
        },
      ];

      const fixed = TimelineAutoFixer.autoFix(slowStoryboard, longHoldBeats, 2);
      expect(fixed.iterations).toBeGreaterThanOrEqual(1);
      expect(fixed.appliedFixes.length).toBeGreaterThan(0);
      expect(fixed.storyboard.characters.length).toBeGreaterThanOrEqual(4);
      expect(fixed.storyboard.scenes.length).toBeGreaterThanOrEqual(3);
      expect(fixed.alignedBeats.length).toBeGreaterThan(longHoldBeats.length); // Split into dynamic cuts
    });
  });

  describe('4. Quality Governor', () => {
    it('should select High tier when projected render time is fast (<= 120s)', () => {
      // 30 frames rendered in 500ms = 60 fps. Total 1800 frames = 30s projected
      const result = QualityGovernor.benchmarkAndSelectTier(500, 30, 1800);
      expect(result.selectedTier).toBe('high');
      expect(result.downscaleFactor).toBe(1.0);
    });

    it('should select Draft tier with downscale when projected time exceeds 180s budget', () => {
      // 30 frames rendered in 4000ms = 7.5 fps. Total 1800 frames = 240s projected (> 180s)
      const result = QualityGovernor.benchmarkAndSelectTier(4000, 30, 1800);
      expect(result.selectedTier).toBe('draft');
      expect(result.downscaleFactor).toBe(0.5);
    });
  });
});
