import path from 'path';
import fs from 'fs';
import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { SpeechSynthesisManager } from '../audio/SpeechSynthesisManager';
import { OrpheusVoiceSynthesizer } from '../audio/OrpheusVoiceSynthesizer';
import { getStoryOutputsDir } from '../StoryPaths';
import { Logger } from '../../../utils/Logger';

import { StoryProviderManager } from '../providers/StoryProviderManager';

export function createVoiceTask(providerManager?: StoryProviderManager): WorkflowTask {
  return {
    id: 'VoiceStage',
    name: 'Voiceover Synthesis (Kokoro-82M / Groq Orpheus / macOS Say)',
    dependencies: ['StoryboardStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<any>(jobId, 'voice');
      if (cached && !context.forceRefresh) {
        Logger.info(`[VoiceStage] Found cached voice artifact for job ${jobId}`);
        return cached.data;
      }

      const storyboard = context.StoryboardStage?.storyboard || context.storyboard;
      if (!storyboard) {
        throw new Error('[VoiceStage] Storyboard missing in workflow context');
      }

      const speechManager = new SpeechSynthesisManager({
        preferredProvider: context.ttsProvider || (process.env.TTS_PROVIDER as any) || 'auto',
      });

      // Map character IDs to voice configurations
      const charVoiceMap = new Map<string, string>();
      for (const char of storyboard.characters) {
        charVoiceMap.set(char.id, char.voice?.id || 'af_heart');
      }

      const lineResults: any[] = [];
      const beats = storyboard.scenes.flatMap((s: any) => s.beats);
      const providersUsed = new Set<string>();
      const allWarnings: string[] = [];

      const outDir = getStoryOutputsDir();

      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        const voiceId = charVoiceMap.get(beat.speaker) || 'af_heart';
        const vocalDir = (beat.directions && beat.directions.length > 0)
          ? beat.directions.join(', ')
          : undefined;

        const synthResult = await speechManager.synthesizeLine(beat.text, voiceId, vocalDir);
        providersUsed.add(synthResult.providerUsed);
        if (synthResult.warnings) {
          allWarnings.push(...synthResult.warnings);
        }

        const lineWavPath = path.join(outDir, `${jobId}_line_${i}.wav`);
        fs.writeFileSync(lineWavPath, synthResult.audioBuffer);

        lineResults.push({
          id: beat.id,
          speaker: beat.speaker,
          text: beat.text,
          voiceId,
          audioBuffer: synthResult.audioBuffer,
          wavPath: lineWavPath,
          durationSec: synthResult.durationSec,
          format: synthResult.format,
          providerUsed: synthResult.providerUsed,
          qualityTier: synthResult.qualityTier,
        });
      }

      // Merge all lines into master voiceover WAV with calibrated natural pause between beats
      const sampleRate = 48000;
      const numChannels = 1;
      const pcmChunks: Buffer[] = [];

      const rawPcmList: Buffer[] = [];
      let totalRawSpeechBytes = 0;
      for (const line of lineResults) {
        const pcmInfo = OrpheusVoiceSynthesizer.extractPcmFromWav(line.audioBuffer);
        rawPcmList.push(pcmInfo.pcm);
        totalRawSpeechBytes += pcmInfo.pcm.length;
      }

      // Calibrated continuous narrator pacing (3.0–4.0 words/s)
      // Reference standard: no silent gap >= 0.25s, at most ONE deliberate pause <= 0.6s at emotional reveal beat
      const introPauseSec = 0.15;
      const outroPauseSec = 0.20;
      const standardPauseSec = 0.18; // strictly <= 0.20s
      const revealPauseSec = 0.50;   // strictly <= 0.60s at reveal beat

      // Identify reveal beat index (around 65% of story or marked as reveal)
      const revealIdx = beats.findIndex((b: any, idx: number) =>
        b.shot?.type === 'extreme_close_up' ||
        b.action === 'reveal' ||
        b.text?.toLowerCase().includes('never told anyone') ||
        idx === Math.floor(beats.length * 0.65)
      );

      // Lead-in pause
      pcmChunks.push(Buffer.alloc(Math.floor(sampleRate * introPauseSec) * 2));

      for (let i = 0; i < rawPcmList.length; i++) {
        const curPcm = rawPcmList[i];

        // Apply quick 15ms fade-in and fade-out to prevent audio pops
        const fadeSamples = Math.floor(sampleRate * 0.015);
        for (let f = 0; f < fadeSamples && f * 2 + 1 < curPcm.length; f++) {
          const factorIn = f / fadeSamples;
          const valIn = curPcm.readInt16LE(f * 2);
          curPcm.writeInt16LE(Math.round(valIn * factorIn), f * 2);

          const endOffset = curPcm.length - 2 - f * 2;
          if (endOffset >= 0 && endOffset + 1 < curPcm.length) {
            const valOut = curPcm.readInt16LE(endOffset);
            curPcm.writeInt16LE(Math.round(valOut * factorIn), endOffset);
          }
        }

        pcmChunks.push(curPcm);

        if (i < rawPcmList.length - 1) {
          const isNextReveal = (i + 1 === revealIdx);
          const gapSec = isNextReveal ? revealPauseSec : standardPauseSec;
          const gapBytes = Math.floor(sampleRate * gapSec) * 2;
          pcmChunks.push(Buffer.alloc(gapBytes));
        }
      }

      // Outro tail pause
      pcmChunks.push(Buffer.alloc(Math.floor(sampleRate * outroPauseSec) * 2));

      const masterPcm = Buffer.concat(pcmChunks);
      const masterWav = OrpheusVoiceSynthesizer.createWavFile(masterPcm, sampleRate, numChannels, 16);
      const masterWavPath = path.join(outDir, `${jobId}_voiceover.wav`);
      fs.writeFileSync(masterWavPath, masterWav);

      const totalDurationSec = masterPcm.length / (sampleRate * 2);
      const outputData = {
        masterWavPath,
        lineResults,
        totalDurationSec,
        pauseSec: standardPauseSec,
        revealPauseSec,
        introPauseSec,
        outroPauseSec,
        providersUsed: Array.from(providersUsed),
        warnings: Array.from(new Set(allWarnings)),
      };

      VersionedArtifactStore.save(jobId, outputData, 'voice', outputData);
      return outputData;
    },
  };
}
