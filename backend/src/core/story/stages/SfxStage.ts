import path from 'path';
import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { SfxIndexer } from '../sfx/SfxIndexer';
import { AudioMixEngine, SfxMixItem } from '../audio/AudioMixEngine';
import { AlignedBeat } from '../audio/WhisperAlignmentEngine';
import { AudioIntegrityValidator } from '../audio/AudioIntegrityValidator';
import { getStoryOutputsDir } from '../StoryPaths';
import { Logger } from '../../../utils/Logger';

export function createSfxTask(): WorkflowTask {
  return {
    id: 'SfxStage',
    name: 'SFX Cue Planning & Ducked Mixdown (Sidechain -12dB, Limiter -6dBFS, Loudnorm -14 LUFS)',
    dependencies: ['AlignmentStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<any>(jobId, 'sfx');
      if (cached && !context.forceRefresh) {
        Logger.info(`[SfxStage] Found cached SFX mix artifact for job ${jobId}`);
        return cached.data;
      }

      const voiceData = context.VoiceStage;
      const alignData = context.AlignmentStage;
      if (!voiceData || !alignData) {
        throw new Error('[SfxStage] Missing VoiceStage or AlignmentStage in context');
      }

      const sfxIndexer = new SfxIndexer();
      const mixEngine = new AudioMixEngine();

      const alignedBeats: AlignedBeat[] = alignData.alignedBeats || [];
      const sfxItems: SfxMixItem[] = [];

      for (const beat of alignedBeats) {
        for (const sfx of beat.sfx) {
          const entry = sfxIndexer.resolveCue(sfx.cue);
          sfxItems.push({
            cue: sfx.cue,
            filePath: entry.path,
            startSec: sfx.startSec,
            gainDb: sfx.gainDb ?? 0,
          });
        }
      }

      const outDir = getStoryOutputsDir();
      const mixedAudioPath = path.join(outDir, `${jobId}_master_mix.wav`);

      await mixEngine.mixAudio({
        voiceoverWavPath: voiceData.masterWavPath,
        sfxItems,
        outputPath: mixedAudioPath,
        targetDurationSec: alignData.totalDurationSec,
      });

      // Acoustic verification & anti-silent success guard
      const audioIntegrity = await AudioIntegrityValidator.verifyVoiceTrack(mixedAudioPath, alignData.alignedBeats);
      if (!audioIntegrity.passed && audioIntegrity.validSpeechBeats === 0) {
        throw new Error(`[SfxStage] Hard-guard check failed: dialogue track is completely silent. ${audioIntegrity.warningMessage || ''}`);
      }

      const outputData = {
        mixedAudioPath,
        sfxCount: sfxItems.length,
        sfxItems,
        totalDurationSec: alignData.totalDurationSec,
        audioIntegrity,
      };

      VersionedArtifactStore.save(jobId, outputData, 'sfx', outputData);
      return outputData;
    },
  };
}
