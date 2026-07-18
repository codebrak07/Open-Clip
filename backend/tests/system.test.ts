import { encryptText, decryptText } from '../src/utils/security';
import { VectorStore } from '../src/services/VectorStore';
import { SemanticEngine } from '../src/services/SemanticEngine';
import { HardwareDetector } from '../src/services/hardwareDetector';
import { DependencyRegistry } from '../src/services/DependencyRegistry';
import { DAGScheduler, DAGNode } from '../src/core/dagScheduler';
import { CommandBus } from '../src/events/CommandBus';
import { OpenClipError } from '../src/core/TypedErrors';
import { FFmpegService } from '../src/services/FFmpegService';
import { MediaFeatureGraph } from '../src/analysis/MediaFeatureGraph';
import { ExplainableScoringEngine } from '../src/analysis/ExplainableScoringEngine';
import { SmartCropEngine } from '../src/renderers/SmartCropEngine';
import { PipelineRegistry } from '../src/pipeline/PipelineRegistry';

describe('OpenClip V6 Production Architecture Test Suite', () => {
  describe('Secrets & Encryption (Phase 11)', () => {
    it('encrypts and decrypts API keys seamlessly', () => {
      const key = 'sk-prod-openclip-secret-key-12345';
      const enc = encryptText(key);
      expect(enc).not.toEqual(key);
      expect(decryptText(enc)).toEqual(key);
    });
  });

  describe('FFmpeg Centralized Service (Phase 13)', () => {
    it('exposes configured binary paths', () => {
      expect(FFmpegService.getFfmpegPath()).toBeDefined();
      expect(FFmpegService.getFfprobePath()).toBeDefined();
    });
  });

  describe('Multimodal MediaFeatureGraph & Explainable Scoring (Phase 5 & 6)', () => {
    it('evaluates candidate clips and provides explicit explanations', () => {
      const graph = new MediaFeatureGraph('job_test');
      graph.addSpeech({ text: 'Hello world welcome to this incredible episode', confidence: 0.98, startTime: 0.5, endTime: 3.5 });
      graph.addFace({ timestamp: 1.0, faceCount: 1, faceCenter: { x: 500, y: 300 }, eyeContactScore: 0.9 });
      graph.addMotion({ timestamp: 1.0, motionDensity: 0.8, cameraMovement: 'pan' });

      const evalResult = ExplainableScoringEngine.evaluateCandidate(graph, 0.5, 3.5);
      expect(evalResult.overallScore).toBeGreaterThan(50);
      expect(evalResult.breakdown.hook).toBeGreaterThan(0);
      expect(evalResult.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('SemanticEngine & Embeddings (Phase 4)', () => {
    it('caches embeddings and conducts vector similarity searches', () => {
      const text = 'podcast interview regarding artificial intelligence';
      const vec1 = SemanticEngine.generateEmbedding(text);
      const vec2 = SemanticEngine.generateEmbedding(text);
      expect(vec1).toBe(vec2); // Cached reference
    });
  });

  describe('SmartCropEngine (Phase 8)', () => {
    it('plans 9:16 crop timeline targeting faces', () => {
      const graph = new MediaFeatureGraph('job_crop');
      graph.addFace({ timestamp: 1.0, faceCount: 1, faceCenter: { x: 800, y: 400 } });

      const cropTimeline = SmartCropEngine.planCropTimeline(graph, 1920, 1080, '9:16');
      expect(cropTimeline.length).toBeGreaterThan(0);
      expect(cropTimeline[0].focusTarget).toBe('face');
    });
  });

  describe('PipelineRegistry & Queue Architecture (Phase 12)', () => {
    it('auto-registers all 15 stages in the declarative pipeline graph', () => {
      const stages = PipelineRegistry.getAllStages();
      expect(stages.length).toBe(15);
      expect(stages.map(s => s.name)).toContain('FrameAnalysisStage');
    });
  });

  describe('System Diagnostics & Dependency Verification (Phase 9 & 10)', () => {
    it('retrieves real hardware metrics', () => {
      const diag = HardwareDetector.getDiagnostics();
      expect(diag.cpu.cores).toBeGreaterThan(0);
      expect(diag.memory.totalMb).toBeGreaterThan(0);
    });

    it('verifies dependencies without throwing', async () => {
      const deps = await DependencyRegistry.verifyAll();
      expect(deps.ffmpeg).toBeDefined();
    });
  });
});
