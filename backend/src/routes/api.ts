import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR, OUTPUTS_DIR } from '../config';
import { db, Job, Clip, JobLog } from '../models/db';
import { ProductionRenderEngine } from '../renderers/ProductionRenderEngine';
import { AspectRatioType } from '../services/RenderEngine';
import { DependencyRegistry } from '../services/DependencyRegistry';
import { SemanticSearchService } from '../services/SemanticSearchService';
import { encryptText } from '../utils/security';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
});


import { HardwareDetector } from '../services/hardwareDetector';
import { VectorStore } from '../services/vectorStore';

/**
 * GET /api/system/diagnostics
 * System health, GPU/CPU hardware acceleration & installed AI dependencies
 */
router.get('/system/diagnostics', async (req, res) => {
  try {
    const diagnostics = await DependencyRegistry.verifyAll();
    const hardware = HardwareDetector.getDiagnostics();
    res.json({
      status: 'online',
      hardware,
      diagnostics: Object.values(diagnostics),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/search/vector
 * Fast in-memory semantic search over long video chunk embeddings
 */
router.post('/search/vector', (req, res) => {
  try {
    const { jobId, query, limit } = req.body;
    if (!jobId || !query) {
      return res.status(400).json({ error: 'jobId and query are required.' });
    }
    const results = VectorStore.search(jobId, query, limit || 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/search/semantic
 * Vector search across transcript and semantic chunks
 */
router.post('/search/semantic', (req, res) => {
  try {
    const { jobId, query } = req.body;
    if (!jobId || !query) {
      return res.status(400).json({ error: 'jobId and query are required.' });
    }
    const results = SemanticSearchService.searchJobContent(jobId, query);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/upload
 */
router.post('/jobs/upload', (req, res, next) => {
  upload.single('video')(req, res, (err: any) => {
    if (err) {
      console.error('[Upload Error]', err);
      return res.status(400).json({ error: err.message || 'File upload error.' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded.' });
      }

      const provider = req.body.provider || 'groq';
      const apiKey = req.body.apiKey || '';
      
      const jobId = 'job_' + Date.now();
      const videoPath = req.file.path;
      const now = Date.now();

      const metadata = {
        originalName: req.file.originalname,
        size: req.file.size,
        provider,
        apiKey: apiKey ? encryptText(apiKey) : undefined,
      };

      const stmt = db.prepare(`
        INSERT INTO jobs (id, status, current_stage, video_path, duration, metadata, created_at, updated_at)
        VALUES (?, 'pending', 'validate', ?, NULL, ?, ?, ?)
      `);
      stmt.run(jobId, videoPath, JSON.stringify(metadata), now, now);

      const logStmt = db.prepare(`
        INSERT INTO job_logs (job_id, stage, message, level, timestamp)
        VALUES (?, 'upload', 'Video file uploaded successfully.', 'info', ?)
      `);
      logStmt.run(jobId, now);

      res.status(201).json({
        message: 'Job created successfully',
        jobId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
});

/**
 * GET /api/jobs/:id
 */
router.get('/jobs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const logs = db.prepare('SELECT * FROM job_logs WHERE job_id = ? ORDER BY timestamp ASC').all(id) as JobLog[];
    
    let parsedMeta: any = {};
    if (job.metadata) {
      parsedMeta = JSON.parse(job.metadata);
      if (parsedMeta.apiKey) {
        parsedMeta.apiKey = 'REDACTED';
      }
    }

    res.json({
      job: {
        ...job,
        metadata: parsedMeta,
      },
      logs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/clips
 */
router.get('/jobs/:id/clips', (req, res) => {
  try {
    const { id } = req.params;
    const clips = db.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY score DESC').all(id) as Clip[];
    
    const formattedClips = clips.map(c => ({
      ...c,
      video_url: c.output_path ? `/outputs/${path.basename(c.output_path)}` : null,
      subtitles_url: c.subtitles_path ? `/outputs/${path.basename(c.subtitles_path)}` : null,
    }));

    res.json({ clips: formattedClips });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/clips/:id/render
 */
router.post('/clips/:id/render', async (req, res) => {
  try {
    const { id } = req.params;
    const aspect = (req.body.aspect || '9:16') as AspectRatioType;

    const clip = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Clip | undefined;
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(clip.job_id) as Job | undefined;
    if (!job || !job.video_path) {
      return res.status(400).json({ error: 'Source video file not found for this clip.' });
    }

    db.prepare("UPDATE clips SET render_status = 'rendering' WHERE id = ?").run(id);

    const duration = clip.end_time - clip.start_time;
    const outputPath = path.join(OUTPUTS_DIR, `${id}.mp4`);
    const srtPath = clip.subtitles_path || path.join(OUTPUTS_DIR, `${id}.srt`);

    if (!fs.existsSync(OUTPUTS_DIR)) {
      fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }

    await ProductionRenderEngine.executeRender({
      jobId: job.id,
      clipId: id,
      sourceVideo: job.video_path,
      startTime: clip.start_time,
      duration,
      subtitlesPath: fs.existsSync(srtPath) ? srtPath : null,
      aspectRatio: aspect,
      outputPath,
    });

    const relativeUrl = `/outputs/${path.basename(outputPath)}`;

    db.prepare(`
      UPDATE clips 
      SET render_status = 'completed', output_path = ?
      WHERE id = ?
    `).run(outputPath, id);

    res.json({
      message: 'Clip rendered successfully',
      clipId: id,
      video_url: relativeUrl,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/:id/batch-render
 */
router.post('/jobs/:id/batch-render', async (req, res) => {
  try {
    const { id } = req.params;
    const minScore = req.body.minScore || 80;
    const aspect = (req.body.aspect || '9:16') as AspectRatioType;

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
    if (!job || !job.video_path) {
      return res.status(404).json({ error: 'Job or video source not found.' });
    }

    const clips = db.prepare('SELECT * FROM clips WHERE job_id = ? AND score >= ?').all(id, minScore) as Clip[];

    if (!fs.existsSync(OUTPUTS_DIR)) {
      fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }

    const renderedClips: Array<{ clipId: string; video_url: string }> = [];

    for (const clip of clips) {
      const duration = clip.end_time - clip.start_time;
      const outputPath = path.join(OUTPUTS_DIR, `${clip.id}.mp4`);
      const srtPath = clip.subtitles_path || path.join(OUTPUTS_DIR, `${clip.id}.srt`);

      await ProductionRenderEngine.executeRender({
        jobId: id,
        clipId: clip.id,
        sourceVideo: job.video_path,
        startTime: clip.start_time,
        duration,
        subtitlesPath: fs.existsSync(srtPath) ? srtPath : null,
        aspectRatio: aspect,
        outputPath,
      });

      const relativeUrl = `/outputs/${path.basename(outputPath)}`;

      db.prepare(`
        UPDATE clips 
        SET render_status = 'completed', output_path = ?
        WHERE id = ?
      `).run(outputPath, clip.id);

      renderedClips.push({ clipId: clip.id, video_url: relativeUrl });
    }

    res.json({
      message: `Batch rendered ${renderedClips.length} clips above virality score ${minScore}`,
      renderedClips,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
