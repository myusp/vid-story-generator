export interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

export class SrtGenerator {
  static msToSrtTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor(ms % 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  static generateSrt(entries: SubtitleEntry[]): string {
    return entries
      .map((entry) => {
        return `${entry.index}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}\n`;
      })
      .join('\n');
  }
}
