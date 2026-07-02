import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface StageMetrics {
  stageName: string;
  jobId: string;
  durationMs: number;
  cpuUsagePct: number;
  memoryMb: number;
  outputCount?: number;
  warnings?: string[];
  fallbacks?: string[];
  status: 'completed' | 'failed' | 'fallback' | 'skipped';
}

export class Logger {
  private static logDir = path.resolve(__dirname, '../../logs');

  private static ensureDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  public static info(message: string, meta?: Record<string, any>) {
    this.log('info', message, meta);
  }

  public static warn(message: string, meta?: Record<string, any>) {
    this.log('warn', message, meta);
  }

  public static error(message: string, meta?: Record<string, any>) {
    this.log('error', message, meta);
  }

  public static stageMetrics(metrics: StageMetrics) {
    this.log('info', `[Stage] ${metrics.stageName} for job ${metrics.jobId} ${metrics.status} in ${metrics.durationMs}ms`, metrics);
  }

  private static log(level: LogLevel, message: string, meta?: Record<string, any>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta || {}),
    };

    console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);

    try {
      this.ensureDir();
      const filePath = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    } catch {
      // Graceful fallback if file writing fails
    }
  }
}
