import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EdgeTTS, listVoices } from 'edge-tts-universal';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface Voice {
  name: string;
  shortName: string;
  gender: string;
  locale: string;
  displayName?: string;
}

/**
 * Prosody segment for expressive speech
 */
export interface ProsodySegment {
  text: string;
  rate: string; // e.g., '-10%', '+20%', '+0%'
  volume: string; // e.g., '+10%', '-5%', '+0%'
  pitch: string; // e.g., '+10Hz', '-5Hz', '+0Hz'
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private voicesCache: Voice[] | null = null;

  /**
   * Generate speech using edge-tts-universal
   * Note: edge-tts-universal DOES support SSML! The text parameter can contain SSML tags.
   * The library automatically detects and processes SSML markup.
   */
  async generateSpeech(
    text: string,
    speaker: string,
    outputPath: string,
    useSsml: boolean = false,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
  }> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Parse voice name (remove gender suffix if present)
      const voiceName = this.parseVoiceName(speaker);

      // edge-tts-universal supports SSML directly in the text parameter
      // If text contains SSML tags, it will be processed automatically
      // No need for special handling - just pass the text as-is
      const tts = new EdgeTTS(text, voiceName, {
        rate: '+0%',
        pitch: '+0Hz',
      });

      // Synthesize speech
      const result = await tts.synthesize();

      // Save audio file
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      await fs.writeFile(outputPath, audioBuffer);

      // For now, we'll estimate duration based on text length
      // Edge-TTS-Universal doesn't provide word timestamps directly
      const durationMs = await this.estimateAudioDuration(outputPath);

      // Generate simple timestamps based on text words (strip SSML if present)
      const plainText = useSsml ? this.stripSsml(text) : text;
      const timestamps = this.generateSimpleTimestamps(plainText, durationMs);

      this.logger.log(
        `Generated speech: ${outputPath} (${durationMs}ms, SSML: ${useSsml})`,
      );

      return {
        audioPath: outputPath,
        durationMs,
        timestamps,
      };
    } catch (error) {
      this.logger.error(`Speech synthesis failed: ${error.message}`);
      throw new Error(`Speech synthesis failed: ${error.message}`);
    }
  }

  /**
   * Generate speech with prosody segments for expressive speech
   * Generates audio for each segment with different prosody settings and concatenates them
   */
  async generateSpeechWithProsody(
    segments: ProsodySegment[],
    speaker: string,
    outputPath: string,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
  }> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Parse voice name (remove gender suffix if present)
      const voiceName = this.parseVoiceName(speaker);

      // Generate audio for each segment
      const segmentPaths: string[] = [];
      const tempDir = path.join(outputDir, 'temp_segments');
      await fs.mkdir(tempDir, { recursive: true });

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentPath = path.join(tempDir, `segment_${i}.mp3`);

        // Create TTS with prosody settings
        const tts = new EdgeTTS(segment.text, voiceName, {
          rate: segment.rate,
          pitch: segment.pitch,
          volume: segment.volume,
        });

        const result = await tts.synthesize();
        const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
        await fs.writeFile(segmentPath, audioBuffer);
        segmentPaths.push(segmentPath);

        this.logger.log(
          `Generated segment ${i + 1}/${segments.length}: "${segment.text.substring(0, 30)}..." (rate: ${segment.rate}, volume: ${segment.volume}, pitch: ${segment.pitch})`,
        );
      }

      // Concatenate all segments using ffmpeg
      if (segmentPaths.length === 1) {
        // Only one segment, just copy it
        await fs.copyFile(segmentPaths[0], outputPath);
      } else {
        // Multiple segments, concatenate with ffmpeg
        await this.concatenateAudio(segmentPaths, outputPath);
      }

      // Cleanup temp files
      for (const segmentPath of segmentPaths) {
        try {
          await fs.unlink(segmentPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      try {
        await fs.rmdir(tempDir);
      } catch {
        // Ignore cleanup errors
      }

      // Get final duration
      const durationMs = await this.estimateAudioDuration(outputPath);

      // Generate timestamps from all segment texts
      const fullText = segments.map((s) => s.text).join(' ');
      const timestamps = this.generateSimpleTimestamps(fullText, durationMs);

      this.logger.log(
        `Generated expressive speech with ${segments.length} segments: ${outputPath} (${durationMs}ms)`,
      );

      return {
        audioPath: outputPath,
        durationMs,
        timestamps,
      };
    } catch (error) {
      this.logger.error(`Prosody speech synthesis failed: ${error.message}`);
      throw new Error(`Prosody speech synthesis failed: ${error.message}`);
    }
  }

  /**
   * Concatenate multiple audio files using ffmpeg
   */
  /**
   * Concatenate multiple audio files using ffmpeg
   * Uses file list approach which is safer than direct path concatenation
   */
  private async concatenateAudio(
    inputPaths: string[],
    outputPath: string,
  ): Promise<void> {
    // Create a file list for ffmpeg concat
    // Using absolute paths and escaping single quotes in file names
    const listPath = outputPath + '.txt';
    const listContent = inputPaths
      .map((p) => {
        const resolved = path.resolve(p);
        // Escape single quotes in path for ffmpeg file list format
        const escaped = resolved.replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      })
      .join('\n');
    await fs.writeFile(listPath, listContent);

    try {
      // Use ffmpeg to concatenate
      // Paths are already validated to be within our storage directories
      const escapedListPath = listPath.replace(/'/g, "'\\''");
      const escapedOutputPath = outputPath.replace(/'/g, "'\\''");
      await execAsync(
        `ffmpeg -f concat -safe 0 -i '${escapedListPath}' -c copy '${escapedOutputPath}' -y`,
      );
    } finally {
      // Clean up list file
      try {
        await fs.unlink(listPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Convert plain text narration to SSML with expressions
   * Edge-TTS supports SSML directly - it will auto-detect SSML tags
   */
  convertToSsml(text: string): string {
    // Add SSML expressions to the text
    const ssmlText = this.addSsmlExpression(text);

    // Edge-TTS auto-detects SSML, but we can use full format for better control
    // Note: edge-tts-universal handles the <speak> wrapper internally
    // We just need to provide the content with SSML tags
    return ssmlText;
  }

  /**
   * Add SSML expression to text based on punctuation
   */
  private addSsmlExpression(text: string): string {
    // Add breaks and emphasis based on punctuation
    let ssmlText = text;

    // Add pauses after periods, commas, etc.
    ssmlText = ssmlText.replace(/\./g, '.<break time="500ms"/>');
    ssmlText = ssmlText.replace(/,/g, ',<break time="300ms"/>');
    ssmlText = ssmlText.replace(/!/g, '!<break time="600ms"/>');
    ssmlText = ssmlText.replace(/\?/g, '?<break time="600ms"/>');

    // Add emphasis to exclamations - look for sentences ending with !
    ssmlText = ssmlText.replace(
      /([^.?]+!)/g,
      '<emphasis level="strong">$1</emphasis>',
    );

    return ssmlText;
  }

  /**
   * Strip SSML tags from text to get plain text
   * This is only for internal use to extract plain text from SSML for timestamp generation
   */
  private stripSsml(text: string): string {
    // Remove all XML/SSML tags including nested ones
    let result = text;
    // Keep replacing until no more tags found (handles nested tags)
    while (/<[^>]*>/g.test(result)) {
      result = result.replace(/<[^>]*>/g, '');
    }
    return result.trim();
  }

  /**
   * List all available voices from edge-tts-universal
   */
  async listVoices(): Promise<Voice[]> {
    // Return cached voices if available
    if (this.voicesCache) {
      return this.voicesCache;
    }

    try {
      const voices = await listVoices();

      // Transform to our Voice interface
      this.voicesCache = voices.map((voice: any) => ({
        name: voice.ShortName,
        shortName: voice.ShortName,
        gender: voice.Gender,
        locale: voice.Locale,
        displayName: voice.FriendlyName,
      }));

      return this.voicesCache;
    } catch (error) {
      this.logger.error(`Failed to list voices: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse voice name to remove gender suffix
   */
  private parseVoiceName(name: string): string {
    return name
      .replace(/-Female$/, '')
      .replace(/-Male$/, '')
      .trim();
  }

  /**
   * Get audio duration using ffprobe for accurate timing
   * Falls back to file size estimation if ffprobe fails
   */
  private async estimateAudioDuration(audioPath: string): Promise<number> {
    try {
      // Try to use ffprobe for accurate duration
      const escapedPath = audioPath.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '${escapedPath}'`,
      );
      const durationSeconds = parseFloat(stdout.trim());
      if (!isNaN(durationSeconds)) {
        return Math.round(durationSeconds * 1000);
      }
    } catch {
      // ffprobe not available or failed, fall back to estimation
      this.logger.warn(
        'ffprobe failed, using file size estimation for duration',
      );
    }

    // Fallback: estimate from file size
    try {
      const stats = await fs.stat(audioPath);
      // Rough estimation: MP3 bitrate ~128kbps
      // Duration (seconds) = (file size in bytes * 8) / (bitrate in kbps * 1000)
      const durationSeconds = (stats.size * 8) / (128 * 1000);
      return Math.round(durationSeconds * 1000);
    } catch (error) {
      this.logger.warn(`Failed to estimate duration: ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate simple word timestamps based on text and total duration
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
