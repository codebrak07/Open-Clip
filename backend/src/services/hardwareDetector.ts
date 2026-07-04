import os from 'os';
import { DependencyRegistry } from './DependencyRegistry';

export interface SystemDiagnostics {
  platform: string;
  arch: string;
  hostname: string;
  uptimeSeconds: number;
  cpu: {
    cores: number;
    model: string;
    loadAverage1Min: number;
    usagePct: number;
  };
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    usagePct: number;
  };
  gpu: {
    accelerator: 'Metal' | 'CUDA' | 'DirectML' | 'CPU';
    deviceName: string;
    available: boolean;
  };
  environment: {
    nodeVersion: string;
    pythonPath: string;
  };
}

export class HardwareDetector {
  public static getDiagnostics(): SystemDiagnostics {
    const platform = process.platform;
    const arch = process.arch;
    const cpus = os.cpus();
    const coreCount = cpus.length || 1;
    const loadAvg = os.loadavg()[0];
    const cpuUsagePct = Math.min(100, Math.round((loadAvg / coreCount) * 100));

    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;

    const totalMb = Math.round(totalMemBytes / (1024 * 1024));
    const usedMb = Math.round(usedMemBytes / (1024 * 1024));
    const freeMb = Math.round(freeMemBytes / (1024 * 1024));
    const memoryUsagePct = Math.round((usedMb / totalMb) * 100);

    let accelerator: 'Metal' | 'CUDA' | 'DirectML' | 'CPU' = 'CPU';
    let deviceName = cpus[0]?.model || 'Host CPU';

    if (platform === 'darwin') {
      accelerator = 'Metal';
      deviceName = 'Apple Metal Hardware Acceleration';
    } else if (platform === 'win32') {
      accelerator = 'DirectML';
      deviceName = 'DirectML Accelerated GPU';
    }

    return {
      platform,
      arch,
      hostname: os.hostname(),
      uptimeSeconds: Math.round(os.uptime()),
      cpu: {
        cores: coreCount,
        model: cpus[0]?.model || 'Generic CPU',
        loadAverage1Min: Math.round(loadAvg * 100) / 100,
        usagePct: cpuUsagePct > 0 ? cpuUsagePct : 10,
      },
      memory: {
        totalMb,
        usedMb,
        freeMb,
        usagePct: memoryUsagePct,
      },
      gpu: {
        accelerator,
        deviceName,
        available: accelerator !== 'CPU',
      },
      environment: {
        nodeVersion: process.version,
        pythonPath: process.env.PYTHON_PATH || 'python3',
      },
    };
  }
}
