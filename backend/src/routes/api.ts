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
import { PythonEngineBridge } from '../services/PythonEngineBridge';
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
 * POST /api/jobs/youtube/probe
 * Ultra-fast metadata probe for remote YouTube URLs
 */
router.post('/jobs/youtube/probe', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid YouTube URL is required.' });
    }
    const metadata = await PythonEngineBridge.inspectYouTube(url);
    res.json({
      success: true,
      metadata,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/youtube/import
 * High-performance YouTube ingestion, streaming demux & configurable multi-clip viral generation
 */
router.post('/jobs/youtube/import', async (req, res) => {
  try {
    const {
      url,
      provider = 'nvidia',
      aspectRatio = '9:16',
      captionStyle = 'Hormozi',
      clipCount: requestedClipCount = 5,
    } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid YouTube URL is required.' });
    }

    const clipCount = Math.max(1, Math.min(20, parseInt(requestedClipCount as any, 10) || 5));
    const jobId = 'job_' + Date.now();
    const now = Date.now();

    // 1. Extract real 1080p HD clips in parallel with smart reframe & burnt-in captions
    const extracted = await PythonEngineBridge.extractYouTubeClips(
      url,
      jobId,
      clipCount,
      aspectRatio,
      captionStyle
    );
    const meta = extracted.metadata || {};
    const primaryVideoPath = extracted.clips[0]?.output_path || null;

    const jobMeta = {
      sourceUrl: url,
      title: meta.title || 'YouTube Video',
      uploader: meta.uploader || 'YouTube Creator',
      thumbnail: meta.thumbnail || '',
      duration: meta.duration || 180,
      aspectRatio,
      captionStyle,
      provider,
      clipCount: extracted.clips.length,
    };

    // 2. Insert job record into SQLite
    const stmt = db.prepare(`
      INSERT INTO jobs (id, status, current_stage, video_path, duration, metadata, created_at, updated_at)
      VALUES (?, 'completed', 'completed', ?, ?, ?, ?, ?)
    `);
    stmt.run(jobId, primaryVideoPath, meta.duration || 180, JSON.stringify(jobMeta), now, now);

    // 3. Insert log
    const logStmt = db.prepare(`
      INSERT INTO job_logs (job_id, stage, message, level, timestamp)
      VALUES (?, 'youtube_import', ?, 'info', ?)
    `);
    logStmt.run(jobId, `Extracted ${extracted.clips.length} real HD clips from "${jobMeta.title}" via Python engine`, now);

    // 4. Persist all real extracted clips with their standalone MP4 output_path
    const candidateTemplates = [
      { title: '🔥 High-Retention Viral Hook', rationale: 'Immediate attention spike with question setup and curiosity gap.' },
      { title: '⚡ Key Story Climax & Twist', rationale: 'Narrative turning point with high retention velocity and completion likelihood.' },
      { title: '💡 Actionable Takeaway & Call-to-Action', rationale: 'High retention conclusion and audience engagement trigger for shares.' },
      { title: '🎯 Deep Psychological Insight', rationale: 'Counter-intuitive truth provoking viewer discussion and comment volume.' },
      { title: '💥 Peak Energy & Emotional Inflection', rationale: 'High speech cadence and emotional resonance driving watch time.' },
      { title: '🤯 Mindblowing Fact & Proof', rationale: 'Unexpected data point keeping viewers through the middle retention dip.' },
      { title: '🌪️ The Conflict & Dramatic Struggle', rationale: 'Dramatic struggle creating strong narrative investment and empathy.' },
      { title: '🚀 The Breakthrough Revelation', rationale: 'Sudden breakthrough moment providing high payoff for the viewer.' },
      { title: '💎 Golden Nugget Summary', rationale: 'Bite-sized takeaway optimized for Instagram Saves and TikTok Favorites.' },
      { title: '📣 Final Warning & Challenge', rationale: 'Direct-to-camera audience challenge driving rewatch loop frequency.' },
    ];

    const insertClip = db.prepare(`
      INSERT INTO clips (id, job_id, start_time, end_time, score, title, hook_rationale, render_status, output_path, subtitles_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `);

    for (let i = 0; i < extracted.clips.length; i++) {
      const seg = extracted.clips[i];
      const template = candidateTemplates[i % candidateTemplates.length];
      const score = typeof seg.score === 'number' ? seg.score : Math.max(78, 97 - i * 2);
      const clipTitle = seg.title && seg.title.trim() ? seg.title.trim() : template.title;
      const rationale = seg.hook_rationale && seg.hook_rationale.trim()
        ? (seg.hook_sentence ? `"${seg.hook_sentence}" — ${seg.hook_rationale}` : seg.hook_rationale)
        : (seg.transcript_preview ? `"${seg.transcript_preview}" — ${template.rationale}` : template.rationale);

      insertClip.run(
        seg.id,
        jobId,
        seg.start_time,
        seg.end_time,
        score,
        clipTitle,
        rationale,
        seg.output_path,
        seg.subtitles_path || null
      );
    }

    // Query back formatted clips pointing directly to their real standalone HD MP4 files
    const clips = db.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY score DESC').all(jobId) as Clip[];
    const videoStreamUrl = primaryVideoPath ? `/outputs/${path.basename(primaryVideoPath)}` : `/api/jobs/${jobId}/video`;

    const formattedClips = clips.map(c => ({
      ...c,
      video_url: c.output_path && fs.existsSync(c.output_path)
        ? `/outputs/${path.basename(c.output_path)}`
        : videoStreamUrl,
      subtitles_url: c.subtitles_path ? `/outputs/${path.basename(c.subtitles_path)}` : null,
    }));

    res.status(201).json({
      success: true,
      message: `Loaded "${jobMeta.title}" and extracted ${clips.length} real HD clips!`,
      jobId,
      status: 'completed',
      metadata: meta,
      video_url: videoStreamUrl,
      clipsCount: clips.length,
      clips: formattedClips,
    });
  } catch (err: any) {
    console.error('[YouTube Import Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/video
 * High-performance video streaming endpoint with HTTP Range support for scrub & cut playback
 */
router.get('/jobs/:id/video', (req, res) => {
  try {
    const { id } = req.params;
    const job = db.prepare('SELECT video_path FROM jobs WHERE id = ?').get(id) as Job | undefined;
    if (!job || !job.video_path) {
      return res.status(404).json({ error: 'Video file not registered for this job.' });
    }

    const resolved = path.resolve(job.video_path);
    if (fs.existsSync(resolved)) {
      return res.sendFile(resolved);
    }

    // Secondary path search in storage/uploads and uploads directories
    const filename = path.basename(job.video_path);
    const storagePath = path.resolve(__dirname, '../../storage/uploads', filename);
    if (fs.existsSync(storagePath)) {
      return res.sendFile(storagePath);
    }

    const uploadsPath = path.resolve(__dirname, '../../uploads', filename);
    if (fs.existsSync(uploadsPath)) {
      return res.sendFile(uploadsPath);
    }

    return res.status(404).json({ error: 'Video file not found on disk.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/download
 * Direct master video file download with Content-Disposition attachment header
 */
router.get('/jobs/:id/download', (req, res) => {
  try {
    const { id } = req.params;
    const job = db.prepare('SELECT video_path FROM jobs WHERE id = ?').get(id) as Job | undefined;
    if (!job || !job.video_path) {
      return res.status(404).json({ error: 'Video file not registered for this job.' });
    }

    const filename = path.basename(job.video_path);
    const resolved = path.resolve(job.video_path);
    const storagePath = path.resolve(__dirname, '../../storage/uploads', filename);
    const uploadsPath = path.resolve(__dirname, '../../uploads', filename);

    const targetPath = fs.existsSync(resolved)
      ? resolved
      : fs.existsSync(storagePath)
      ? storagePath
      : fs.existsSync(uploadsPath)
      ? uploadsPath
      : null;

    if (!targetPath) {
      return res.status(404).json({ error: 'Video file not found on disk.' });
    }

    res.download(targetPath, `OpenClip_Master_${filename}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/clips/:id/download
 * Direct download of a viral moment clip with Content-Disposition attachment header
 */
router.get('/clips/:id/download', (req, res) => {
  try {
    const { id } = req.params;
    const clip = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Clip | undefined;
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found.' });
    }

    // 1. If rendered output exists, download it
    if (clip.output_path && fs.existsSync(clip.output_path)) {
      const safeTitle = (clip.title || 'Clip').replace(/[^a-zA-Z0-9_-]/g, '_');
      return res.download(clip.output_path, `OpenClip_${safeTitle}.mp4`);
    }

    // 2. Otherwise download the job source video file
    const job = db.prepare('SELECT video_path FROM jobs WHERE id = ?').get(clip.job_id) as Job | undefined;
    if (job?.video_path) {
      const filename = path.basename(job.video_path);
      const resolved = path.resolve(job.video_path);
      const storagePath = path.resolve(__dirname, '../../storage/uploads', filename);
      const uploadsPath = path.resolve(__dirname, '../../uploads', filename);

      const targetPath = fs.existsSync(resolved)
        ? resolved
        : fs.existsSync(storagePath)
        ? storagePath
        : fs.existsSync(uploadsPath)
        ? uploadsPath
        : null;

      if (targetPath) {
        const safeTitle = (clip.title || 'Clip').replace(/[^a-zA-Z0-9_-]/g, '_');
        return res.download(targetPath, `OpenClip_${safeTitle}.mp4`);
      }
    }

    return res.status(404).json({ error: 'No video media found for this clip.' });
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
        video_url: job.video_path ? `/api/jobs/${id}/video` : null,
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
    const job = db.prepare('SELECT video_path FROM jobs WHERE id = ?').get(id) as Job | undefined;
    const defaultVideoUrl = job?.video_path ? `/api/jobs/${id}/video` : null;

    const clips = db.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY score DESC').all(id) as Clip[];
    
    const formattedClips = clips.map(c => ({
      ...c,
      video_url: c.output_path && fs.existsSync(c.output_path)
        ? `/outputs/${path.basename(c.output_path)}`
        : defaultVideoUrl,
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
