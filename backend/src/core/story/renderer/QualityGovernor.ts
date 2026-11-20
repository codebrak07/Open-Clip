import { Logger } from '../../../utils/Logger';

export type QualityTier = 'high' | 'standard' | 'draft';

export interface GovernorBenchmarkResult {
  sampleFrames: number;
  sampleElapsedMs: number;
  sampleFps: number;
  projectedTotalSec: number;
  selectedTier: QualityTier;
  targetBudgetSec: number;
  downscaleFactor: number;
}

export class QualityGovernor {
  private static TARGET_BUDGET_SEC = 180; // 3 minutes maximum wall-clock render

  /**
   * Evaluates the first 30 rendered frames and selects the optimal quality tier.
   */
  public static benchmarkAndSelectTier(
    sampleElapsedMs: number,
    sampleFrames: number,
    totalFrames: number
  ): GovernorBenchmarkResult {
    const sampleFps = sampleFrames / (sampleElapsedMs / 1000);
    const projectedTotalSec = totalFrames / sampleFps;

    let selectedTier: QualityTier = 'standard';
    let downscaleFactor = 1.0;

    if (projectedTotalSec <= 120) {
      selectedTier = 'high';
      downscaleFactor = 1.0;
    } else if (projectedTotalSec <= this.TARGET_BUDGET_SEC) {
      selectedTier = 'standard';
      downscaleFactor = 1.0;
    } else {
      // Over budget: select Draft tier with downscaled internal buffer
      selectedTier = 'draft';
      downscaleFactor = 0.5; // Render at 540x960 and upscale
      Logger.warn(
        `[QualityGovernor] Projected render time ${projectedTotalSec.toFixed(1)}s exceeds budget ${this.TARGET_BUDGET_SEC}s. Downgrading to Draft Tier.`
      );
    }

    Logger.info(
      `[QualityGovernor] Benchmark: ${sampleFrames} frames in ${sampleElapsedMs}ms (${sampleFps.toFixed(1)} fps). Projected: ${projectedTotalSec.toFixed(1)}s. Selected Tier: ${selectedTier.toUpperCase()}`
    );

    return {
      sampleFrames,
      sampleElapsedMs,
      sampleFps: Number(sampleFps.toFixed(1)),
      projectedTotalSec: Number(projectedTotalSec.toFixed(1)),
      selectedTier,
      targetBudgetSec: this.TARGET_BUDGET_SEC,
      downscaleFactor,
    };
  }
}
