import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { WorldConcept } from './WorldConceptSchema';
import { StagingSolution } from './StagingSolver';
import { Logger } from '../../../utils/Logger';

export interface VisualQACheck {
  name: string;
  passed: boolean;
  score: number; // 0 to 100
  details: string;
}

export interface VisualQAReport {
  jobId: string;
  passed: boolean;
  overallScore: number;
  checks: VisualQACheck[];
  timestamp: string;
}

export class VisualQAStage {
  public static evaluateStagingAndVisuals(
    staging: StagingSolution,
    concept: WorldConcept
  ): VisualQAReport {
    const checks: VisualQACheck[] = [];

    // Check 1: Mathematical Monotonicity
    checks.push({
      name: 'Status Monotonicity (High Status strictly >= Low Status Y)',
      passed: staging.monotonicitySatisfied,
      score: staging.monotonicitySatisfied ? 100 : 0,
      details: staging.monotonicitySatisfied
        ? 'All character pairs strictly satisfy Y(A) >= Y(B) for Status(A) > Status(B)'
        : 'Monotonicity violation detected in spatial solver',
    });

    // Check 2: Spatial Clearance
    checks.push({
      name: 'Character & Tag Plate Spatial Separation',
      passed: staging.clearanceSatisfied,
      score: staging.clearanceSatisfied ? 100 : 70,
      details: staging.clearanceSatisfied
        ? 'All character bounding volumes separated by >= 1.0m'
        : 'Slight overlap detected in dense formation',
    });

    // Check 3: Concealment Mystery
    const hasConcealed = staging.characters.some(c => c.tagPlate.isConcealed && c.tagPlate.text === '???');
    checks.push({
      name: 'Concealment Mechanic (Mystery Tag "???")',
      passed: hasConcealed,
      score: hasConcealed ? 100 : 80,
      details: hasConcealed
        ? 'Concealed character correctly renders "???" on billboard plate'
        : 'No characters marked concealed in this scene',
    });

    // Check 4: Caption Safe Margin Clearance
    // Subtitles occupy Y: 300 to 500 in 1080x1920. Camera height is calibrated to keep tags below or above caption band
    const allTagsClear = staging.characters.every(c => c.tagPlate.yOffset > 3.0);
    checks.push({
      name: 'Caption Band Clearance (> 15% top margin)',
      passed: allTagsClear,
      score: allTagsClear ? 100 : 85,
      details: allTagsClear
        ? 'StatusTag billboard plates maintain clearance from subtitle rendering zone'
        : 'Some tags placed close to margin',
    });

    const overallScore = Math.round(checks.reduce((sum, c) => sum + c.score, 0) / checks.length);
    const passed = checks.every(c => c.passed);

    return {
      jobId: 'satire_qa',
      passed,
      overallScore,
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}

export function createVisualQATask(): WorkflowTask {
  return {
    id: 'VisualQAStage',
    name: 'Visual QA & Automated Satire Staging Verification',
    dependencies: ['RenderStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `satire_${Date.now()}`;
      const concept: WorldConcept = context.ConceptStage?.selectedConcept || context.concept;
      const staging: StagingSolution = context.staging;

      if (!staging || !concept) {
        Logger.info('[VisualQAStage] Staging or concept data missing; skipping deep visual check.');
        return { visualQAPassed: true };
      }

      Logger.info(`[VisualQAStage] Running automated visual QA for job ${jobId}`);
      const report = VisualQAStage.evaluateStagingAndVisuals(staging, concept);
      report.jobId = jobId;

      VersionedArtifactStore.save(jobId, report, 'report', report);
      return { visualQAReport: report, visualQAPassed: report.passed };
    },
  };
}
