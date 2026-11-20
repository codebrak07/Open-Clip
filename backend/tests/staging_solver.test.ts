import { StagingSolver } from '../src/core/story/satire/StagingSolver';
import { WorldConcept } from '../src/core/story/satire/WorldConceptSchema';
import { StatusEngine } from '../src/core/story/satire/StatusEngine';

describe('StagingSolver - 1,000 Iteration Mathematical Property Tests', () => {
  const sampleConcept: WorldConcept = {
    tag: 'exam rank',
    openingLine: 'In this world, your exam rank dictates your place in town.',
    metric: {
      name: 'Rank',
      format: 'ordinal',
      direction: 'lower_is_better', // lower number = higher societal status
      min: 1,
      max: 1000000,
    },
    display: 'tag',
    tiers: [
      { id: 'tier_top', label: 'Top Rank', minVal: 1, maxVal: 100, color: '#f59e0b' },
      { id: 'tier_mid', label: 'Average', minVal: 101, maxVal: 50000, color: '#3b82f6' },
      { id: 'tier_low', label: 'Bottom Rank', minVal: 50001, maxVal: 1000000, color: '#64748b' },
    ],
    effects: {
      housing: { tier_top: 'mansion', tier_mid: 'flat', tier_low: 'garage' },
      elevation: { tier_top: 'stage', tier_mid: 'ground', tier_low: 'pit' },
      treatment: { tier_top: 'bow', tier_mid: 'ignore', tier_low: 'shoo_away' },
    },
    ironies: [
      { roleOrJob: 'Town Mayor', value: 750000, effect: 'Runs town from garage' },
    ],
    concealment: {
      mechanic: 'wool scarf wrap',
      item: 'scarf',
      reactions: ['whispers', 'shocked gasps'],
    },
    setPieces: [
      { id: 'sp_1', location: 'wedding_hall', formation: 'tiered_crowd', gag: 'ladder garland', escalation: 'high stage' },
      { id: 'sp_2', location: 'garage_office', formation: 'town_hall', gag: 'council in garage', escalation: 'vip visitor' },
      { id: 'sp_3', location: 'mansion_exterior', formation: 'queue', gag: 'red carpet bus', escalation: 'wind gust' },
    ],
    twist: 'The top rank wears a paper bag because nobody cares about who he is',
    buttonGag: 'The cat sneezes at his rank',
    callback: 'The opening rank rule pays off at the wedding',
  };

  it('should format values correctly across all supported metric formats', () => {
    expect(StatusEngine.formatValue(750000, 'indian_grouping')).toBe('7,50,000');
    expect(StatusEngine.formatValue(1, 'ordinal')).toBe('1st');
    expect(StatusEngine.formatValue(2, 'ordinal')).toBe('2nd');
    expect(StatusEngine.formatValue(3, 'ordinal')).toBe('3rd');
    expect(StatusEngine.formatValue(4, 'ordinal')).toBe('4th');
    expect(StatusEngine.formatValue(98.5, 'percent')).toBe('99%');
    expect(StatusEngine.formatValue(4500000, 'currency_inr')).toBe('₹45,00,000');
    expect(StatusEngine.formatValue(10000000, 'k_m')).toBe('10M');
    expect(StatusEngine.formatValue(500000, 'k_m')).toBe('500K');
  });

  it('should mask tag text to "???" when character is concealed', () => {
    const res = StatusEngine.resolveStatus(1, sampleConcept, true);
    expect(res.displayPlateText).toBe('???');
    expect(res.isConcealed).toBe(true);

    const resVisible = StatusEngine.resolveStatus(1, sampleConcept, false);
    expect(resVisible.displayPlateText).toBe('Rank: 1st');
    expect(resVisible.isConcealed).toBe(false);
  });

  it('should strictly satisfy Monotonicity over 1,000 randomized property tests', () => {
    let passedIterations = 0;

    for (let iter = 0; iter < 1000; iter++) {
      // Random cast size from 2 to 12
      const castSize = Math.floor(Math.random() * 11) + 2;
      const isLowerBetter = iter % 2 === 0;

      const dynamicConcept: WorldConcept = {
        ...sampleConcept,
        metric: {
          ...sampleConcept.metric,
          direction: isLowerBetter ? 'lower_is_better' : 'higher_is_better',
        },
      };

      const mockCharacters = [];
      for (let c = 0; c < castSize; c++) {
        mockCharacters.push({
          id: `char_${c}`,
          name: `Character ${c}`,
          metricValue: Math.floor(Math.random() * 1000000) + 1,
          isConcealed: Math.random() < 0.2,
        });
      }

      const solution = StagingSolver.solveStaging(mockCharacters, dynamicConcept);
      expect(solution.characters.length).toBe(castSize);

      // Verify Mathematical Monotonicity Property:
      // For any pair (A, B): if Status(A) > Status(B) => Y(A) >= Y(B)
      for (let i = 0; i < solution.characters.length; i++) {
        for (let j = 0; j < solution.characters.length; j++) {
          if (i === j) continue;
          const charA = solution.characters[i];
          const charB = solution.characters[j];

          const diff = StatusEngine.compareStatus(
            charA.metricValue,
            charB.metricValue,
            dynamicConcept.metric.direction
          );

          if (diff > 0) {
            // Char A has strictly higher social status than Char B
            // Therefore, Char A must be positioned at or above Char B in Y
            expect(charA.position.y).toBeGreaterThanOrEqual(charB.position.y);
          }
        }
      }

      // Verify no two characters occupy identical 3D points
      for (let i = 0; i < solution.characters.length - 1; i++) {
        for (let j = i + 1; j < solution.characters.length; j++) {
          const charA = solution.characters[i];
          const charB = solution.characters[j];
          const sameX = charA.position.x === charB.position.x;
          const sameY = charA.position.y === charB.position.y;
          const sameZ = charA.position.z === charB.position.z;
          expect(sameX && sameY && sameZ).toBe(false);
        }
      }

      passedIterations++;
    }

    expect(passedIterations).toBe(1000);
  });
});
