import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../../models/db';
import { StoryStudioService } from '../../core/story/StoryStudioService';
import { validateStoryboard, formatValidationErrors, loadStoryCatalog } from '../../core/story/StorySchema';
import { VersionedArtifactStore } from '../../core/storage/VersionedArtifactStore';
import { getStoryOutputsDir, resolveStoryFile } from '../../core/story/StoryPaths';
import { SpeechSynthesisManager } from '../../core/story/audio/SpeechSynthesisManager';
import { ConceptStage } from '../../core/story/satire/ConceptStage';
import { CastGenerator } from '../../core/story/satire/CastGenerator';
import { DirectorStage } from '../../core/story/satire/DirectorStage';
import { StagingSolver } from '../../core/story/satire/StagingSolver';
import { VisualQAStage } from '../../core/story/satire/VisualQAStage';
import { StatusEngine } from '../../core/story/satire/StatusEngine';
import { WorldConcept } from '../../core/story/satire/WorldConceptSchema';
import { Logger } from '../../utils/Logger';

const router = Router();
const storyService = new StoryStudioService();
const catalog = loadStoryCatalog();

// In-memory active jobs map
interface StoryJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  currentStage: string;
  error?: string;
  result?: any;
  createdAt: number;
}

const activeJobs = new Map<string, StoryJobStatus>();

// 1. POST /api/v1/story (Primary generation endpoint)
const handleStoryGenerate = async (req: Request, res: Response) => {
  try {
    const {
      tag,
      concept: customConcept,
      idea: rawIdea,
      durationSec = 60,
      tone = 'humorous',
      characterCount = 2,
      seed = 42,
      ttsProvider = 'auto',
      renderImmediately = true,
    } = req.body;

    if (!tag && !customConcept && !rawIdea) {
      return res.status(400).json({ error: 'At least one of "tag", "concept", or "idea" is required' });
    }

    const jobId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const jobStatus: StoryJobStatus = {
      jobId,
      status: 'queued',
      progress: 5,
      currentStage: 'Initializing',
      createdAt: Date.now(),
    };
    activeJobs.set(jobId, jobStatus);

    (async () => {
      try {
        jobStatus.status = 'running';
        jobStatus.progress = 10;

        let resolvedConcept: WorldConcept | null = customConcept || null;
        let idea = rawIdea;

        if (tag && !resolvedConcept) {
          jobStatus.currentStage = 'ConceptStage';
          const conceptStage = new ConceptStage(storyService.getProviderManager());
          const conceptRes = await conceptStage.generateConcepts({ tag, count: 3 });
          resolvedConcept = conceptRes.selectedConcept;
        }

        if (resolvedConcept) {
          jobStatus.currentStage = 'CastAndStaging';
          const generatedCast = CastGenerator.generateCast(resolvedConcept, 6, 2);
          const staging = StagingSolver.solveStaging(
            generatedCast.characters.map(c => ({
              id: c.id,
              name: c.name,
              role: c.role,
              metricValue: c.metricValue,
              isConcealed: c.isConcealed,
            })),
            resolvedConcept
          );
          const qaReport = VisualQAStage.evaluateStagingAndVisuals(staging, resolvedConcept);
          idea = `${resolvedConcept.openingLine} Society strictly segregates citizens by ${resolvedConcept.tag}. Set piece gags: ${resolvedConcept.setPieces.map(s => s.gag).join('; ')}. Twist: ${resolvedConcept.twist}. Button gag: ${resolvedConcept.buttonGag}. Callback: ${resolvedConcept.callback}`;

          const satireSidecarPath = resolveStoryFile(jobId, '.satire.json');
          fs.writeFileSync(
            satireSidecarPath,
            JSON.stringify({ concept: resolvedConcept, cast: generatedCast, staging, qaReport }, null, 2),
            'utf-8'
          );
        }

        jobStatus.progress = 30;
        jobStatus.currentStage = 'ScriptStage';

        const finalResult = await storyService.generateStoryVideo({
          jobId,
          idea: idea || 'In this world, numbers float above heads',
          durationSec: Number(durationSec) || 60,
          tone,
          characterCount: Number(characterCount) || 2,
          seed: Number(seed) || 42,
          ttsProvider,
        });

        jobStatus.status = 'completed';
        jobStatus.progress = 100;
        jobStatus.currentStage = 'Completed';
        jobStatus.result = {
          ...(finalResult.ExportStage || finalResult),
          concept: resolvedConcept,
        };
      } catch (err: any) {
        Logger.error(`[StoryRouter] Job ${jobId} failed: ${err.message}`, err);
        jobStatus.status = 'failed';
        jobStatus.error = err.message;
        jobStatus.currentStage = 'Failed';
      }
    })();

    res.status(202).json({
      jobId,
      status: 'queued',
      message: 'Story Studio job accepted and processing in background',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/', handleStoryGenerate);
router.post('/generate', handleStoryGenerate);

// 2. GET /api/v1/story/catalog
router.get('/catalog', (req: Request, res: Response) => {
  res.json(catalog);
});

// 3. GET /api/v1/story/:jobId (and /job/:jobId alias)
const handleGetJobStatus = (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job) {
    // Check if artifacts exist on disk
    const mp4Path = resolveStoryFile(jobId, '.mp4');
    if (fs.existsSync(mp4Path)) {
      return res.json({
        jobId,
        status: 'completed',
        progress: 100,
        currentStage: 'Completed',
        result: { masterVideoPath: mp4Path },
      });
    }
    return res.status(404).json({ error: `Job ${jobId} not found` });
  }
  res.json(job);
};

router.get('/:jobId', handleGetJobStatus);
router.get('/job/:jobId', handleGetJobStatus);

// 4. GET /api/v1/story/:jobId/storyboard
router.get('/:jobId/storyboard', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const cached = VersionedArtifactStore.load(jobId, 'storyboard');
  if (cached) {
    return res.json(cached.data);
  }
  const diskPath = resolveStoryFile(jobId, '.storyboard.json');
  if (fs.existsSync(diskPath)) {
    const data = JSON.parse(fs.readFileSync(diskPath, 'utf-8'));
    return res.json(data);
  }
  res.status(404).json({ error: 'Storyboard not found for this job' });
});

// 5. PUT /api/v1/story/:jobId/storyboard (Edit in-place with schema revalidation)
router.put('/:jobId/storyboard', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const newStoryboard = req.body;

  const validation = validateStoryboard(newStoryboard, catalog);
  if (!validation.success) {
    const errors = formatValidationErrors(validation);
    return res.status(400).json({
      error: 'Storyboard validation failed against catalog schema',
      validationErrors: errors,
    });
  }

  VersionedArtifactStore.save(jobId, validation.data, 'storyboard', validation.data);
  const diskPath = path.join(getStoryOutputsDir(), `${jobId}.storyboard.json`);
  fs.writeFileSync(diskPath, JSON.stringify(validation.data, null, 2), 'utf-8');

  res.json({
    message: 'Storyboard updated and validated successfully',
    storyboard: validation.data,
  });
});

// 6. POST /api/v1/story/:jobId/render (Render from modified storyboard)
router.post('/:jobId/render', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const { ttsProvider } = req.body || {};
  const cached = VersionedArtifactStore.load(jobId, 'storyboard');
  let storyboard = cached?.data;

  if (!storyboard) {
    const diskPath = path.resolve(process.cwd(), `backend/storage/outputs/${jobId}.storyboard.json`);
    if (fs.existsSync(diskPath)) {
      storyboard = JSON.parse(fs.readFileSync(diskPath, 'utf-8'));
    }
  }

  if (!storyboard) {
    return res.status(400).json({ error: 'No validated storyboard found to render' });
  }

  const renderJobId = `${jobId}_render_${Date.now()}`;
  const jobStatus: StoryJobStatus = {
    jobId: renderJobId,
    status: 'running',
    progress: 40,
    currentStage: 'VoiceStage',
    createdAt: Date.now(),
  };
  activeJobs.set(renderJobId, jobStatus);

  (async () => {
    try {
      const finalResult = await storyService.renderFromStoryboard(jobId, storyboard, ttsProvider);
      jobStatus.status = 'completed';
      jobStatus.progress = 100;
      jobStatus.currentStage = 'Completed';
      jobStatus.result = finalResult.ExportStage || finalResult;
    } catch (err: any) {
      jobStatus.status = 'failed';
      jobStatus.error = err.message;
      jobStatus.currentStage = 'Failed';
    }
  })();

  res.status(202).json({
    jobId: renderJobId,
    parentJobId: jobId,
    status: 'queued',
    message: 'Render initiated from storyboard',
  });
});

// 6b. TTS Voices & Preview
router.get('/tts/voices', (req: Request, res: Response) => {
  res.json({
    catalogVoices: catalog.voices || [],
    providers: [
      { id: 'auto', name: 'Auto (Kokoro -> Groq -> macOS Say)' },
      { id: 'kokoro-local', name: 'Kokoro-82M (Local Offline ONNX)' },
      { id: 'groq-orpheus', name: 'Groq Orpheus (Cloud API)' },
      { id: 'macos-say', name: 'macOS Say (Native Offline)' },
    ],
  });
});

router.post('/tts/preview', async (req: Request, res: Response) => {
  try {
    const { text = 'Hello! This is a voice preview from OpenClip Story Studio.', voiceId = 'af_heart', provider = 'auto' } = req.body;
    const manager = new SpeechSynthesisManager({ preferredProvider: provider });
    const result = await manager.synthesizeLine(text, voiceId);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', result.audioBuffer.length);
    res.setHeader('X-TTS-Provider', result.providerUsed);
    res.send(result.audioBuffer);
  } catch (err: any) {
    Logger.error(`[StoryRouter] TTS preview error: ${err.message}`, err);
    res.status(500).json({ error: err.message });
  }
});

// 6c. Satire Concept Generation
router.post('/concepts', async (req: Request, res: Response) => {
  try {
    const { tag, prefix = 'In this world, ', count = 3 } = req.body;
    if (!tag || typeof tag !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "tag" string' });
    }
    const conceptStage = new ConceptStage(storyService.getProviderManager());
    const result = await conceptStage.generateConcepts({ tag, prefix, count: Number(count) || 3 });
    res.json(result);
  } catch (err: any) {
    Logger.error(`[StoryRouter] Concept generation error: ${err.message}`, err);
    res.status(500).json({ error: err.message });
  }
});

// 6d. Satire Video Pipeline Generation
router.post('/generate-satire', async (req: Request, res: Response) => {
  try {
    const { tag, concept: customConcept, ttsProvider = 'auto', seed = 42, durationSec = 45 } = req.body;
    if (!tag && !customConcept) {
      return res.status(400).json({ error: 'Either "tag" or "concept" is required' });
    }

    const conceptStage = new ConceptStage(storyService.getProviderManager());
    const resolvedConcept: WorldConcept = customConcept || (await conceptStage.generateConcepts({ tag, count: 1 })).selectedConcept;

    const jobId = `satire_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const jobStatus: StoryJobStatus = {
      jobId,
      status: 'queued',
      progress: 5,
      currentStage: 'ConceptStaging',
      createdAt: Date.now(),
    };
    activeJobs.set(jobId, jobStatus);

    // Launch pipeline in background
    (async () => {
      try {
        jobStatus.status = 'running';
        jobStatus.progress = 15;
        jobStatus.currentStage = 'CastAndStaging';

        // 1. Generate cast with StagingSolver
        const generatedCast = CastGenerator.generateCast(resolvedConcept, 6, 2);
        const staging = StagingSolver.solveStaging(
          generatedCast.characters.map(c => ({
            id: c.id,
            name: c.name,
            role: c.role,
            metricValue: c.metricValue,
            isConcealed: c.isConcealed,
          })),
          resolvedConcept
        );

        // 2. Visual QA Audit
        const qaReport = VisualQAStage.evaluateStagingAndVisuals(staging, resolvedConcept);

        jobStatus.progress = 30;
        jobStatus.currentStage = 'SatireScriptAndStoryboard';

        // Build prompt idea from concept
        const idea = `${resolvedConcept.openingLine} Society strictly segregates citizens by ${resolvedConcept.tag}. Set piece gags: ${resolvedConcept.setPieces.map(s => s.gag).join('; ')}. Twist: ${resolvedConcept.twist}. Button gag: ${resolvedConcept.buttonGag}. Callback: ${resolvedConcept.callback}`;

        // Generate full video through deterministic Story Studio pipeline
        const finalResult = await storyService.generateStoryVideo({
          jobId,
          idea,
          durationSec: Number(durationSec) || 45,
          tone: 'humorous',
          characterCount: 2,
          seed: Number(seed) || 42,
          ttsProvider,
        });

        // Save satire metadata sidecar
        const satireSidecarPath = resolveStoryFile(jobId, '.satire.json');
        fs.writeFileSync(
          satireSidecarPath,
          JSON.stringify({ concept: resolvedConcept, cast: generatedCast, staging, qaReport }, null, 2),
          'utf-8'
        );

        jobStatus.status = 'completed';
        jobStatus.progress = 100;
        jobStatus.currentStage = 'Completed';
        jobStatus.result = {
          ...(finalResult.ExportStage || finalResult),
          concept: resolvedConcept,
          qaReport,
        };
      } catch (err: any) {
        Logger.error(`[StoryRouter] Satire job ${jobId} failed: ${err.message}`, err);
        jobStatus.status = 'failed';
        jobStatus.error = err.message;
        jobStatus.currentStage = 'Failed';
      }
    })();

    res.status(202).json({
      jobId,
      status: 'queued',
      concept: resolvedConcept,
      message: 'Satire Studio job accepted and running in background',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6e. GET /api/v1/story/:jobId/satire
router.get('/:jobId/satire', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const sidecarPath = resolveStoryFile(jobId, '.satire.json');
  if (fs.existsSync(sidecarPath)) {
    return res.json(JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')));
  }
  res.status(404).json({ error: 'Satire metadata not found for this job' });
});

// 7. GET /api/v1/story/:jobId/export (Download master MP4)
router.get('/:jobId/export', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const outPath = resolveStoryFile(jobId, '.mp4');
  if (!fs.existsSync(outPath)) {
    return res.status(404).json({ error: 'Master MP4 not found for this job' });
  }
  res.download(outPath, `${jobId}.mp4`);
});

// 8. GET /api/v1/story/:jobId/sidecars/:kind
router.get('/:jobId/sidecars/:kind', (req: Request, res: Response) => {
  const { jobId, kind } = req.params;
  const allowed = ['storyboard', 'words', 'sfx', 'report', 'parity', 'satire'];
  if (!allowed.includes(kind)) {
    return res.status(400).json({ error: `Invalid sidecar kind. Allowed: ${allowed.join(', ')}` });
  }

  const sidecarPath = resolveStoryFile(jobId, `.${kind}.json`);
  if (!fs.existsSync(sidecarPath)) {
    return res.status(404).json({ error: `Sidecar "${kind}" not found for job ${jobId}` });
  }

  const data = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
  res.json(data);
});

// 9. POST /api/v1/story/:jobId/approve-concept
router.post('/:jobId/approve-concept', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { concept, durationSec = 60, ttsProvider = 'auto' } = req.body;
    if (!concept) {
      return res.status(400).json({ error: 'Missing approved "concept" object' });
    }

    const jobStatus: StoryJobStatus = {
      jobId,
      status: 'running',
      progress: 20,
      currentStage: 'CastAndStaging',
      createdAt: Date.now(),
    };
    activeJobs.set(jobId, jobStatus);

    (async () => {
      try {
        const generatedCast = CastGenerator.generateCast(concept, 6, 2);
        const staging = StagingSolver.solveStaging(
          generatedCast.characters.map(c => ({
            id: c.id,
            name: c.name,
            role: c.role,
            metricValue: c.metricValue,
            isConcealed: c.isConcealed,
          })),
          concept
        );
        const qaReport = VisualQAStage.evaluateStagingAndVisuals(staging, concept);
        const idea = `${concept.openingLine} Society strictly segregates citizens by ${concept.tag}. Set piece gags: ${concept.setPieces.map((s: any) => s.gag).join('; ')}. Twist: ${concept.twist}. Button gag: ${concept.buttonGag}. Callback: ${concept.callback}`;

        const finalResult = await storyService.generateStoryVideo({
          jobId,
          idea,
          durationSec: Number(durationSec) || 60,
          tone: 'humorous',
          characterCount: 2,
          seed: 42,
          ttsProvider,
        });

        jobStatus.status = 'completed';
        jobStatus.progress = 100;
        jobStatus.currentStage = 'Completed';
        jobStatus.result = {
          ...(finalResult.ExportStage || finalResult),
          concept,
          qaReport,
        };
      } catch (err: any) {
        jobStatus.status = 'failed';
        jobStatus.error = err.message;
        jobStatus.currentStage = 'Failed';
      }
    })();

    res.status(202).json({
      jobId,
      status: 'queued',
      message: 'Concept approved; full video generation initiated',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. GET /api/v1/story/:jobId/contact-sheet.jpg
router.get('/:jobId/contact-sheet.jpg', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const sheetPath = resolveStoryFile(jobId, '.contact-sheet.jpg');
  if (fs.existsSync(sheetPath)) {
    return res.sendFile(sheetPath);
  }
  const altPath = path.join(getStoryOutputsDir(), `${jobId}.contact-sheet.jpg`);
  if (fs.existsSync(altPath)) {
    return res.sendFile(altPath);
  }
  res.status(404).json({ error: 'Contact sheet not found for job ' + jobId });
});

// 11. GET /api/v1/story/:jobId/parity.json
router.get('/:jobId/parity.json', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const parityPath = resolveStoryFile(jobId, '.parity.json');
  if (fs.existsSync(parityPath)) {
    return res.sendFile(parityPath);
  }
  res.status(404).json({ error: 'Parity report not found for job ' + jobId });
});

export default router;
