import { exec } from 'child_process';
import util from 'util';
import { FFMPEG_PATH } from '../config';

const execPromise = util.promisify(exec);

export class Encoder {
  static async encode(
    sourceVideo: string,
    startTime: number,
    duration: number,
    filterString: string,
    outputPath: string
  ): Promise<void> {
    const ffmpegBin = FFMPEG_PATH || 'ffmpeg';
    const filterArg = filterString ? `-vf "${filterString}"` : '';
    const cmd = `"${ffmpegBin}" -y -ss ${startTime} -t ${duration} -i "${sourceVideo}" ${filterArg} -c:v libx264 -preset superfast -c:a aac "${outputPath}"`;
    await execPromise(cmd);
  }
}
