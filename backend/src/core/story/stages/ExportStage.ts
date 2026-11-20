import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { StoryPopCaptionEngine } from '../captions/StoryPopCaptionEngine';
import { evaluateParity } from '../../../cli/storyParity';
import { getStoryOutputsDir } from '../StoryPaths';
import { FFMPEG_PATH } from '../../../config';
import { Logger } from '../../../utils/Logger';

export function createExportTask(): WorkflowTask {
  return {
    id: 'ExportStage',
    name: 'Master Multiplex & Sidecar Export (9:16 MP4 + Storyboard + Words + SFX + Report + Parity + Contact Sheet)',
    dependencies: ['RenderStage', 'SfxStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const storyboard = context.StoryboardStage?.storyboard || context.storyboard;
      const alignData = context.AlignmentStage;
      const renderData = context.RenderStage;
      const sfxData = context.SfxStage;

      if (!storyboard || !alignData || !renderData || !sfxData) {
        throw new Error('[ExportStage] Missing upstream stage dependencies');
      }

      const outDir = getStoryOutputsDir();

      const finalVideoPath = path.join(outDir, `${jobId}.mp4`);
      const assPath = path.join(outDir, `${jobId}_captions.ass`);
      const thumbPath = path.join(outDir, `${jobId}_thumb.jpg`);

      // 1. Generate "story_pop" ASS subtitles
      StoryPopCaptionEngine.generateAssSubtitles(alignData.alignedBeats, assPath, 1080, 1920);

      // 2. Multiplex Video + Mixed Audio + Burnt-in Subtitles
      const ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

      // Use h264_videotoolbox if on macOS
      const vCodecArgs = process.platform === 'darwin'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', '7000k', '-pix_fmt', 'yuv420p']
        : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p'];

      const muxArgs = [
        '-y',
        '-loglevel', 'error',
        '-i', renderData.rawVideoPath,
        '-i', sfxData.mixedAudioPath,
        '-vf', `ass=${escapedAssPath}`,
        ...vCodecArgs,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        finalVideoPath,
      ];

      Logger.info(`[ExportStage] Muxing master video + captions -> ${finalVideoPath}`);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, muxArgs);
        let errStr = '';
        proc.stderr.on('data', chunk => {
          errStr += chunk.toString();
        });
        proc.on('close', code => {
          if (code === 0 && fs.existsSync(finalVideoPath)) {
            resolve();
          } else {
            // Fallback without subtitle filter if libass missing in test environment
            Logger.warn(`[ExportStage] Subtitle burn failed (${errStr}), falling back to direct video+audio mux...`);
            const fallbackArgs = [
              '-y', '-loglevel', 'error',
              '-i', renderData.rawVideoPath,
              '-i', sfxData.mixedAudioPath,
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-b:a', '192k',
              '-shortest',
              finalVideoPath,
            ];
            const procFb = spawn(ffmpegBin, fallbackArgs);
            procFb.on('close', fbCode => {
              if (fbCode === 0 && fs.existsSync(finalVideoPath)) {
                resolve();
              } else {
                reject(new Error(`[ExportStage] Export mux failed: ${errStr}`));
              }
            });
          }
        });
        proc.on('error', err => reject(err));
      });

      // 3. Extract Thumbnail at peak beat
      const peakBeat = alignData.alignedBeats[Math.floor(alignData.alignedBeats.length * 0.6)] || alignData.alignedBeats[0];
      const thumbTime = peakBeat ? peakBeat.startSec + 0.5 : 1.0;

      await new Promise<void>((resolve) => {
        const thumbProc = spawn(ffmpegBin, [
          '-y', '-loglevel', 'error',
          '-ss', thumbTime.toFixed(2),
          '-i', finalVideoPath,
          '-vframes', '1',
          '-q:v', '2',
          thumbPath,
        ]);
        thumbProc.on('close', () => resolve());
        thumbProc.on('error', () => resolve());
      });

      // 4. Parity Verification & Review Artifacts Generation
      let parityReport: any = null;
      try {
        parityReport = evaluateParity(finalVideoPath);
      } catch (parityErr: any) {
        Logger.warn(`[ExportStage] Parity audit warning: ${parityErr.message}`);
      }

      // 5. Export Sidecars
      const storyboardSidecar = path.join(outDir, `${jobId}.storyboard.json`);
      fs.writeFileSync(storyboardSidecar, JSON.stringify(storyboard, null, 2), 'utf-8');

      const wordsSidecar = path.join(outDir, `${jobId}.words.json`);
      fs.writeFileSync(wordsSidecar, JSON.stringify(alignData.allWords, null, 2), 'utf-8');

      const sfxSidecar = path.join(outDir, `${jobId}.sfx.json`);
      fs.writeFileSync(sfxSidecar, JSON.stringify(sfxData.sfxItems, null, 2), 'utf-8');

      const reportSidecar = path.join(outDir, `${jobId}.report.json`);
      const status = parityReport && parityReport.status === 'passed' ? 'completed' : 'completed_with_warnings';
      const warnings = parityReport?.warnings || [];

      const reportData = {
        jobId,
        status,
        warnings,
        generatedAt: new Date().toISOString(),
        totalDurationSec: alignData.totalDurationSec,
        renderSpeedFps: renderData.fpsRenderSpeed,
        renderElapsedMs: renderData.elapsedMs,
        encoderUsed: renderData.encoderUsed,
        renderedFx: renderData.renderedFx || [],
        audioIntegrity: sfxData.audioIntegrity || {},
        sfxCount: sfxData.sfxCount,
        wordsCount: alignData.allWords.length,
        parityScore: parityReport ? {
          overallPassed: parityReport.overallPassed,
          status: parityReport.status,
          checks: parityReport.checks,
        } : null,
        artifacts: {
          video: finalVideoPath,
          thumbnail: thumbPath,
          storyboard: storyboardSidecar,
          words: wordsSidecar,
          sfx: sfxSidecar,
          parity: parityReport?.parityJsonPath,
          contactSheet: parityReport?.contactSheetPath,
        },
      };
      fs.writeFileSync(reportSidecar, JSON.stringify(reportData, null, 2), 'utf-8');

      VersionedArtifactStore.save(jobId, reportData, 'export', reportData);

      return {
        masterVideoPath: finalVideoPath,
        thumbnailPath: thumbPath,
        sidecars: {
          storyboard: storyboardSidecar,
          words: wordsSidecar,
          sfx: sfxSidecar,
          report: reportSidecar,
          parity: parityReport?.parityJsonPath,
          contactSheet: parityReport?.contactSheetPath,
        },
        parityReport,
        report: reportData,
      };
    },
  };
}
