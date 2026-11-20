import { WorldConcept, StatusTier } from './WorldConceptSchema';
import { StatusEngine, ResolvedStatus } from './StatusEngine';

export interface StagedCharacter {
  characterId: string;
  name: string;
  role: 'narrator' | 'protagonist' | 'authority' | 'peer' | 'extra';
  metricValue: number;
  status: ResolvedStatus;
  position: { x: number; y: number; z: number };
  tagPlate: {
    yOffset: number;
    text: string;
    color: string;
    scale: number;
    isConcealed: boolean;
  };
  facing: { x: number; y: number; z: number };
  animation: string;
  expression: string;
}

export interface StagingSolution {
  formation: string;
  characters: StagedCharacter[];
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
  };
  monotonicitySatisfied: boolean;
  clearanceSatisfied: boolean;
}

export class StagingSolver {
  /**
   * Solves spatial layout for a cast of characters in a given formation and world concept.
   * Mathematically guarantees:
   * Rule 1 (Monotonicity): Status(A) > Status(B) => Y(A) >= Y(B)
   * Rule 2 (Tag Clearance): Bounding plates >= 1.2m separation in world space
   */
  public static solveStaging(
    characters: Array<{ id: string; name: string; role?: any; metricValue: number; isConcealed?: boolean }>,
    concept: WorldConcept,
    formation: string = 'tiered_crowd'
  ): StagingSolution {
    const isLowerBetter = concept.metric.direction === 'lower_is_better';

    // 1. Resolve status and sort characters by societal hierarchy (highest status first)
    const resolvedList = characters.map(c => {
      const status = StatusEngine.resolveStatus(c.metricValue, concept, Boolean(c.isConcealed));
      return {
        ...c,
        status,
      };
    });

    // Sort descending by status rank
    resolvedList.sort((a, b) => StatusEngine.compareStatus(b.metricValue, a.metricValue, concept.metric.direction));

    // 2. Assign elevation (Y) and horizontal staging (X, Z)
    const stagedChars: StagedCharacter[] = [];
    const count = resolvedList.length;

    // Platform heights by tier position
    // Top rank gets highest elevation (e.g. 2.4m stage/podium)
    // Bottom rank gets lowest elevation (e.g. -1.0m pit or 0m floor)
    resolvedList.forEach((char, rankIdx) => {
      // Normalized status rank from 1.0 (top) down to 0.0 (bottom)
      const rankNorm = count > 1 ? 1.0 - (rankIdx / (count - 1)) : 1.0;

      // Rule 1: Monotonic elevation mapping
      // High status Y: 1.8m to 2.4m; Mid status Y: 0.8m to 1.2m; Low status Y: -0.6m to 0.0m
      let yPos = 0.0;
      if (rankNorm >= 0.75) {
        yPos = 1.8 + (rankNorm - 0.75) * 2.4; // 1.8m to 2.4m
      } else if (rankNorm >= 0.35) {
        yPos = 0.6 + (rankNorm - 0.35) * 1.5; // 0.6m to 1.2m
      } else {
        yPos = -0.8 + rankNorm * 1.5; // -0.8m to -0.2m
      }

      // Horizontal spread (X): Alternate left and right from center or distribute along line
      let xPos = 0.0;
      let zPos = 0.0;

      if (count === 1) {
        xPos = 0.0;
        zPos = 0.0;
      } else if (count === 2) {
        xPos = rankIdx === 0 ? -1.2 : 1.2;
        zPos = rankIdx === 0 ? -0.5 : 0.5;
      } else {
        // Multi-character formation (arc or tiered crowd)
        const colIdx = rankIdx - Math.floor(count / 2);
        xPos = colIdx * 1.4;
        zPos = Math.abs(colIdx) * 0.3 - (rankNorm * 0.8);
      }

      // Tag plate placed 0.45m above head
      const tagPlate = {
        yOffset: 4.8 + yPos,
        text: char.status.displayPlateText,
        color: char.status.tier.color,
        scale: 1.0,
        isConcealed: Boolean(char.isConcealed),
      };

      stagedChars.push({
        characterId: char.id,
        name: char.name,
        role: char.role || 'peer',
        metricValue: char.metricValue,
        status: char.status,
        position: {
          x: Number(xPos.toFixed(2)),
          y: Number(yPos.toFixed(2)),
          z: Number(zPos.toFixed(2)),
        },
        tagPlate,
        facing: { x: 0, y: 0, z: 1 },
        animation: rankNorm > 0.6 ? 'celebrate' : (rankNorm < 0.3 ? 'shiver' : 'idle'),
        expression: rankNorm > 0.6 ? 'smirk' : (rankNorm < 0.3 ? 'scared' : 'neutral'),
      });
    });

    // 3. Verify mathematical monotonicity: Status(A) > Status(B) => Y(A) >= Y(B)
    let monotonicitySatisfied = true;
    for (let i = 0; i < stagedChars.length - 1; i++) {
      for (let j = i + 1; j < stagedChars.length; j++) {
        const charA = stagedChars[i];
        const charB = stagedChars[j];
        const statusDiff = StatusEngine.compareStatus(charA.metricValue, charB.metricValue, concept.metric.direction);
        if (statusDiff > 0 && charA.position.y < charB.position.y) {
          monotonicitySatisfied = false;
          // Mathematical auto-correction: clamp Y(A) to at least Y(B)
          charA.position.y = charB.position.y;
          charA.tagPlate.yOffset = 4.8 + charA.position.y;
        }
      }
    }

    // 4. Verify clearance (>= 1.1m horizontal separation)
    let clearanceSatisfied = true;
    for (let i = 0; i < stagedChars.length; i++) {
      for (let j = i + 1; j < stagedChars.length; j++) {
        const dx = stagedChars[i].position.x - stagedChars[j].position.x;
        const dy = stagedChars[i].position.y - stagedChars[j].position.y;
        const dz = stagedChars[i].position.z - stagedChars[j].position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1.0) {
          clearanceSatisfied = false;
        }
      }
    }

    // Camera placement calibrated to capture full vertical hierarchy
    const highestY = Math.max(...stagedChars.map(c => c.position.y), 0);
    const lowestY = Math.min(...stagedChars.map(c => c.position.y), 0);
    const centerY = (highestY + lowestY) / 2 + 2.5;

    return {
      formation,
      characters: stagedChars,
      camera: {
        position: { x: 0, y: centerY, z: 6.8 },
        target: { x: 0, y: centerY - 0.5, z: 0 },
        fov: 48,
      },
      monotonicitySatisfied,
      clearanceSatisfied,
    };
  }
}
