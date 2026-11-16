import { spawn } from 'child_process';
import path from 'path';
import { PYTHON_PATH } from '../config';

export class PythonEngineBridge {
  private static pythonEngineDir = path.resolve(__dirname, '../../python-engine');

  public static async runCommand(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn(PYTHON_PATH, ['-m', 'openclip_engine.cli.main', ...args], {
        cwd: this.pythonEngineDir,
        env: {
          ...process.env,
          PYTHONPATH: this.pythonEngineDir,
        },
      });

      let stdoutData = '';
      let stderrData = '';

      pythonProcess.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      pythonProcess.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Find JSON in output if present
            const firstBrace = stdoutData.indexOf('{');
            const lastBrace = stdoutData.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
              const jsonStr = stdoutData.substring(firstBrace, lastBrace + 1);
              resolve(JSON.parse(jsonStr));
            } else {
              resolve({ output: stdoutData.trim() });
            }
          } catch {
            resolve({ output: stdoutData.trim() });
          }
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderrData || stdoutData}`));
        }
      });

      pythonProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });
  }

  public static async inspectSource(source: string): Promise<any> {
    return this.runCommand(['inspect', source]);
  }

  public static async runDoctor(): Promise<any> {
    return this.runCommand(['doctor']);
  }

  public static async resolveFootball(matchText: string, language: string = 'English', style: string = 'Passionate Fan'): Promise<any> {
    return this.runCommand(['football', matchText, '--language', language, '--style', style]);
  }
}
