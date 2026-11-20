import path from 'path';
import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { BlockWorldRenderer } from '../renderer/BlockWorldRenderer';
import { TimelineAutoFixer } from '../satire/TimelineAutoFixer';
import { getStoryOutputsDir } from '../StoryPaths';
import { Logger } from '../../../utils/Logger';

export function createRenderTask(): WorkflowTask {
  return {
    id: 'RenderStage',
    name: 'BlockWorld 3D Playwright Deterministic Rendering (Three.js 9:16 + Timeline Auto-Fix)',
    dependencies: ['AlignmentStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<any>(jobId, 'render');
      if (cached && !context.forceRefresh) {
        Logger.info(`[RenderStage] Found cached render artifact for job ${jobId}`);
        return cached.data;
      }

      const rawStoryboard = context.StoryboardStage?.storyboard || context.storyboard;
      const alignData = context.AlignmentStage;
      if (!rawStoryboard || !alignData) {
        throw new Error('[RenderStage] Missing StoryboardStage or AlignmentStage in context');
      }

      // Pre-Render Timeline Auto-Fix Loop
      const autoFixResult = TimelineAutoFixer.autoFix(rawStoryboard, alignData.alignedBeats, 2);
      const storyboard = autoFixResult.storyboard;
      const alignedBeats = autoFixResult.alignedBeats;

      const renderer = new BlockWorldRenderer();
      const outDir = getStoryOutputsDir();
      const rawVideoPath = path.join(outDir, `${jobId}_blockworld_raw.mp4`);

      const result = await renderer.renderVideo({
        storyboard,
        alignedBeats,
        durationSec: alignData.totalDurationSec,
        outputPath: rawVideoPath,
        fps: 30,
        width: 1080,
        height: 1920,
      });

      const outputData = {
        rawVideoPath: result.outputPath,
        totalFrames: result.totalFrames,
        fpsRenderSpeed: result.fpsRenderSpeed,
        elapsedMs: result.elapsedMs,
        encoderUsed: result.encoderUsed,
        renderedFx: result.renderedFx || [],
        timelineAutoFix: {
          iterations: autoFixResult.iterations,
          appliedFixes: autoFixResult.appliedFixes,
          finalAudit: autoFixResult.finalAudit,
        },
      };

      VersionedArtifactStore.save(jobId, outputData, 'render', outputData);
      return outputData;
    },
  };
}
