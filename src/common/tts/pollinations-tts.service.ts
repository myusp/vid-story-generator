import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PollinationsVoice {
  name: string;
  description: string;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleWordBoundary {
  text: string;
  offset: number;
  duration: number;
}

@Injectable()
export class PollinationsTtsService {
  private readonly logger = new Logger(PollinationsTtsService.name);
  private readonly baseUrl = 'https://text.pollinations.ai';

  // List of Pollinations TTS voices based on OpenAI TTS
  private readonly pollinationsVoices: PollinationsVoice[] = [
    { name: 'alloy', description: 'Neutral, professional' },
    { name: 'echo', description: 'Deep, resonant' },
    { name: 'fable', description: 'Storyteller vibe' },
    { name: 'onyx', description: 'Warm, rich' },
    { name: 'nova', description: 'Bright, friendly' },
    { name: 'shimmer', description: 'Soft, melodic' },
  ];

  /**
   * Generate speech using Pollinations TTS
   */
  async generateSpeech(
    text: string,
    voiceName: string,
    outputPath: string,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
    wordBoundaries: SubtitleWordBoundary[];
  }> {
    this.logger.log(`Starting Pollinations TTS generation for ${outputPath}`);
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Encode text for URL
      const encodedText = encodeURIComponent(text);

      // Construct Pollinations TTS URL
      const url = `${this.baseUrl}/${encodedText}?model=openai-audio&voice=${voiceName}`;

      this.logger.log(`Calling Pollinations TTS API with voice: ${voiceName}`);

      // Download audio from Pollinations
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout
      });

      // Save audio file
      this.logger.log(`Saving audio file to ${outputPath}`);
      await fs.writeFile(outputPath, Buffer.from(response.data));

      // Get audio duration
      const durationMs = await this.estimateAudioDuration(outputPath);

      // Generate simple timestamps
      const timestamps = this.generateSimpleTimestamps(text, durationMs);

      // For now, no word boundaries from Pollinations TTS
      const wordBoundaries: SubtitleWordBoundary[] = [];

      this.logger.log(
        `Generated Pollinations TTS speech: ${outputPath} (${durationMs}ms)`,
      );

      return {
        audioPath: outputPath,
        durationMs,
        timestamps,
        wordBoundaries,
      };
    } catch (error) {
      this.logger.error(`Pollinations TTS synthesis failed: ${error.message}`);
      this.logger.error(error.stack);
      throw new Error(`Pollinations TTS synthesis failed: ${error.message}`);
    }
  }

  /**
   * List available Pollinations TTS voices
   */
  listVoices(): PollinationsVoice[] {
    return this.pollinationsVoices;
  }

  /**
   * Get audio duration using ffprobe
   */
  private async estimateAudioDuration(audioPath: string): Promise<number> {
    try {
      const escapedPath = audioPath.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '${escapedPath}'`,
      );
      const durationSeconds = parseFloat(stdout.trim());
      if (!isNaN(durationSeconds)) {
        return Math.round(durationSeconds * 1000);
      }
    } catch {
      this.logger.warn(
        'ffprobe failed, using file size estimation for duration',
      );
    }

    // Fallback: estimate from file size
    try {
      const stats = await fs.stat(audioPath);
      // Rough estimation for MP3: assume 128kbps bitrate
      const durationSeconds = (stats.size * 8) / (128 * 1000);
      return Math.round(durationSeconds * 1000);
    } catch (error) {
      this.logger.warn(`Failed to estimate duration: ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate simple word timestamps
   */
  private generateSimpleTimestamps(
    text: string,
    totalDurationMs: number,
  ): WordTimestamp[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const timestamps: WordTimestamp[] = [];

    if (words.length === 0) {
      return timestamps;
    }

    const msPerWord = totalDurationMs / words.length;

    words.forEach((word, index) => {
      timestamps.push({
        word,
        startMs: Math.round(index * msPerWord),
        endMs: Math.round((index + 1) * msPerWord),
      });
    });

    return timestamps;
  }
}
