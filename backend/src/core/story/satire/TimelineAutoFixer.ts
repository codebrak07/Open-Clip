import { Logger } from '../../../utils/Logger';

export interface TimelineAuditResult {
  durationSec: number;
  cutsPerMinute: number;
  maxHoldSec: number;
  deadAirRatio: number;
  captionCoverageRatio: number;
  visualEventRatio: number;
  environmentCount: number;
  castCount: number;
  passed: boolean;
  warnings: string[];
}

export interface AutoFixResult {
  storyboard: any;
  alignedBeats: any[];
  iterations: number;
  initialAudit: TimelineAuditResult;
  finalAudit: TimelineAuditResult;
  appliedFixes: string[];
}

export class TimelineAutoFixer {
  public static auditTimeline(storyboard: any, alignedBeats: any[]): TimelineAuditResult {
    const totalDuration = alignedBeats.length > 0
      ? alignedBeats[alignedBeats.length - 1].endSec - alignedBeats[0].startSec
      : 0;

    const durationMin = Math.max(0.1, totalDuration / 60);

    // 1. Cut cadence
    let shotCount = 0;
    let maxHoldSec = 0;
    for (let i = 0; i < alignedBeats.length; i++) {
      const b = alignedBeats[i];
      const hold = (b.endSec - b.startSec);
      if (hold > maxHoldSec) maxHoldSec = hold;
      shotCount++;
    }
    const cutsPerMinute = Number((shotCount / durationMin).toFixed(1));

    // 2. Dead air
    let totalSpeech = 0;
    for (const b of alignedBeats) {
      if (b.words && b.words.length > 0) {
        for (const w of b.words) {
          totalSpeech += (w.end - w.start);
        }
      } else {
        totalSpeech += (b.endSec - b.startSec);
      }
    }
    const deadAirSec = Math.max(0, totalDuration - totalSpeech);
    const deadAirRatio = totalDuration > 0 ? Number((deadAirSec / totalDuration).toFixed(3)) : 0;

    // 3. Caption coverage
    const beatsWithWords = alignedBeats.filter(b => b.words && b.words.length > 0).length;
    const captionCoverageRatio = alignedBeats.length > 0 ? Number((beatsWithWords / alignedBeats.length).toFixed(2)) : 0;

    // 4. Visual event coverage
    const beatsWithVisuals = alignedBeats.filter(b => (b.actions && b.actions.length > 0) || (b.visualEvents && b.visualEvents.length > 0)).length;
    const visualEventRatio = alignedBeats.length > 0 ? Number((beatsWithVisuals / alignedBeats.length).toFixed(2)) : 0;

    // 5. Environments
    const envSet = new Set<string>();
    for (const scene of storyboard.scenes || []) {
      if (scene.location) envSet.add(scene.location);
      if (scene.id) envSet.add(scene.id);
    }
    const environmentCount = envSet.size || 1;

    // 6. Cast
    const castCount = storyboard.characters?.length || 2;

    const warnings: string[] = [];
    if (cutsPerMinute < 15.0) warnings.push(`Low cuts/min: ${cutsPerMinute} < 15.0`);
    if (maxHoldSec > 3.0) warnings.push(`Max shot hold exceeded: ${maxHoldSec.toFixed(1)}s > 3.0s`);
    if (deadAirRatio > 0.05) warnings.push(`High dead air ratio: ${(deadAirRatio * 100).toFixed(1)}% > 5.0%`);
    if (captionCoverageRatio < 0.90) warnings.push(`Low caption coverage: ${(captionCoverageRatio * 100).toFixed(1)}% < 90%`);
    if (environmentCount < 3) warnings.push(`Low environment variety: ${environmentCount} < 3`);
    if (castCount < 4) warnings.push(`Low cast count: ${castCount} < 4`);

    return {
      durationSec: Number(totalDuration.toFixed(1)),
      cutsPerMinute,
      maxHoldSec: Number(maxHoldSec.toFixed(2)),
      deadAirRatio,
      captionCoverageRatio,
      visualEventRatio,
      environmentCount,
      castCount,
      passed: warnings.length === 0,
      warnings,
    };
  }

  public static autoFix(storyboard: any, alignedBeats: any[], maxIterations: number = 2): AutoFixResult {
    const initialAudit = this.auditTimeline(storyboard, alignedBeats);
    const appliedFixes: string[] = [];
    let currentSb = JSON.parse(JSON.stringify(storyboard));
    let currentBeats = JSON.parse(JSON.stringify(alignedBeats));

    let iteration = 0;
    while (iteration < maxIterations) {
      iteration++;
      const audit = this.auditTimeline(currentSb, currentBeats);
      if (audit.passed) break;

      // Fix 1: Environments variety (< 3)
      if (audit.environmentCount < 3) {
        const defaultEnvironments = ['sunny_town', 'cafeteria', 'bedroom', 'winter_storm'];
        if (!currentSb.scenes || currentSb.scenes.length < 3) {
          currentSb.scenes = [
            { id: 'scene_1', location: 'sunny_town', name: 'Town Square' },
            { id: 'scene_2', location: 'cafeteria', name: 'Institution Cafeteria' },
            { id: 'scene_3', location: 'bedroom', name: 'Private Quarters' },
            { id: 'scene_4', location: 'winter_storm', name: 'The Cold Heights' },
          ];
        }
        appliedFixes.push(`Expanded environment count to ${currentSb.scenes.length} distinct locations`);
      }

      // Fix 2: Cast count (< 4)
      if (audit.castCount < 4) {
        currentSb.characters = currentSb.characters || [];
        const needed = 4 - currentSb.characters.length;
        for (let i = 0; i < needed; i++) {
          const cId = `citizen_${currentSb.characters.length + 1}`;
          currentSb.characters.push({
            id: cId,
            name: `Citizen ${currentSb.characters.length + 1}`,
            role: 'citizen',
            metricValue: 40 + i * 15,
            status: 'Standard',
            tierColor: '#3b82f6',
            look: {
              skin: i % 2 === 0 ? 'skin_tan' : 'skin_light',
              top: { style: 'top_hoodie', color: 'color_blue' },
              bottom: { style: 'bottom_jeans', color: 'bottom_jeans' },
              hair: { style: 'hair_short_messy', color: 'hair_brown' },
            },
          });
        }
        appliedFixes.push(`Populated background cast to reach ${currentSb.characters.length} characters`);
      }

      // Fix 3: Shot cadence / long holds (> 3.0s or cuts/min < 15)
      if (audit.maxHoldSec > 3.0 || audit.cutsPerMinute < 15.0) {
        const newBeats: any[] = [];
        for (const b of currentBeats) {
          const hold = b.endSec - b.startSec;
          if (hold > 3.0 && b.words && b.words.length >= 4) {
            // Split beat into two dynamic shots
            const midTime = b.startSec + hold / 2;
            const midWordIdx = Math.floor(b.words.length / 2);

            const b1 = {
              ...b,
              id: `${b.id}_a`,
              endSec: midTime,
              words: b.words.slice(0, midWordIdx),
              shot: { type: 'close_up', move: 'dolly_in', target: b.speaker },
            };
            const b2 = {
              ...b,
              id: `${b.id}_b`,
              startSec: midTime,
              words: b.words.slice(midWordIdx),
              shot: { type: 'two_shot', move: 'pan_right', target: b.speaker },
            };
            newBeats.push(b1, b2);
          } else {
            // Ensure dynamic camera move on static shot
            if (!b.shot || b.shot.move === 'static') {
              b.shot = {
                type: b.shot?.type || 'medium',
                move: newBeats.length % 2 === 0 ? 'pan_left' : 'pan_right',
                target: b.speaker,
              };
            }
            newBeats.push(b);
          }
        }
        currentBeats = newBeats;
        appliedFixes.push(`Split long shots (>3.0s) and injected dynamic camera cuts`);
      }

      // Fix 4: Visual events coverage (< 90%)
      if (audit.visualEventRatio < 0.90) {
        currentBeats.forEach((b: any, bIdx: number) => {
          if (!b.actions || b.actions.length === 0) {
            b.actions = [{
              actor: b.speaker,
              anim: bIdx % 2 === 0 ? 'talk_gesture' : 'point',
              expression: 'neutral',
              atWord: 0,
            }];
          }
        });
        appliedFixes.push(`Ensured 100% visual events on all dialogue cards`);
      }
    }

    const finalAudit = this.auditTimeline(currentSb, currentBeats);
    Logger.info(`[TimelineAutoFixer] Timeline Auto-Fix ran ${iteration} iteration(s). Initial warnings: ${initialAudit.warnings.length}, Final warnings: ${finalAudit.warnings.length}`);

    return {
      storyboard: currentSb,
      alignedBeats: currentBeats,
      iterations: iteration,
      initialAudit,
      finalAudit,
      appliedFixes,
    };
  }
}
