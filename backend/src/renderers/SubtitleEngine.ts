export class SubtitleEngine {
  static getFFmpegSubtitleFilter(srtPath: string | null): string | null {
    if (!srtPath) return null;
    const escapedSrtPath = srtPath.replace(/'/g, "'\\\\''").replace(/:/g, '\\:');
    return `subtitles='${escapedSrtPath}':force_style='Alignment=2,FontSize=18,PrimaryColour=&H00FFFF&'`;
  }
}
