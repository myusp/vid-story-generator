import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ApiKeyRollingService } from '../ai/api-key-rolling.service';

const execAsync = promisify(exec);

export interface GeminiVoice {
  name: string;
  gender: 'Male' | 'Female';
  sampleUrl?: string;
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

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

@Injectable()
export class GeminiTtsService {
  private readonly logger = new Logger(GeminiTtsService.name);
  private readonly geminiTtsModel: string;

  // Audio format constants
  private static readonly DEFAULT_SAMPLE_RATE = 44100;
  private static readonly DEFAULT_BITS_PER_SAMPLE = 16;
  private static readonly DEFAULT_CHANNELS = 2;

  // List of Gemini TTS voices based on documentation
  private readonly geminiVoices: GeminiVoice[] = [
    { name: 'Achernar', gender: 'Female' },
    { name: 'Achird', gender: 'Male' },
    { name: 'Algenib', gender: 'Male' },
    { name: 'Algieba', gender: 'Male' },
    { name: 'Alnilam', gender: 'Male' },
    { name: 'Aoede', gender: 'Female' },
    { name: 'Autonoe', gender: 'Female' },
    { name: 'Callirrhoe', gender: 'Female' },
    { name: 'Charon', gender: 'Male' },
    { name: 'Despina', gender: 'Female' },
    { name: 'Enceladus', gender: 'Male' },
    { name: 'Erinome', gender: 'Female' },
    { name: 'Fenrir', gender: 'Male' },
    { name: 'Gacrux', gender: 'Female' },
    { name: 'Iapetus', gender: 'Male' },
    { name: 'Kore', gender: 'Female' },
    { name: 'Laomedeia', gender: 'Female' },
    { name: 'Leda', gender: 'Female' },
    { name: 'Orus', gender: 'Male' },
    { name: 'Pulcherrima', gender: 'Female' },
    { name: 'Puck', gender: 'Male' },
    { name: 'Rasalgethi', gender: 'Male' },
    { name: 'Sadachbia', gender: 'Male' },
    { name: 'Sadaltager', gender: 'Male' },
    { name: 'Schedar', gender: 'Male' },
    { name: 'Sulafat', gender: 'Female' },
    { name: 'Umbriel', gender: 'Male' },
    { name: 'Vindemiatrix', gender: 'Female' },
    { name: 'Zephyr', gender: 'Female' },
    { name: 'Zubenelgenubi', gender: 'Male' },
  ];

  constructor(
    private configService: ConfigService,
    private apiKeyRolling: ApiKeyRollingService,
  ) {
    this.geminiTtsModel = this.configService.get<string>(
      'GEMINI_TTS_MODEL',
      'gemini-2.5-pro-preview-tts',
    );
  }

  /**
   * Generate speech using Gemini TTS
   */
  async generateSpeech(
    text: string,
    voiceName: string,
    outputPath: string,
    stylePrompt?: string,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
    wordBoundaries: SubtitleWordBoundary[];
  }> {
    this.logger.log(`Starting Gemini TTS generation for ${outputPath}`);
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Get API key from rolling service
      const apiKey = this.apiKeyRolling.getNextGeminiTtsKey();

      // Initialize Gemini AI
      const ai = new GoogleGenAI({
        apiKey,
      });

      // Configure TTS settings
      const config: any = {
        temperature: 1,
        responseModalities: ['audio'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            },
          },
        },
      };

      // Add system instruction if style prompt is provided
      if (stylePrompt) {
        config.systemInstruction = {
          parts: [{ text: stylePrompt }],
        };
      }

      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: text,
            },
          ],
        },
      ];

      // Generate content stream
      this.logger.log(
        `Calling Gemini TTS API with voice: ${voiceName}${stylePrompt ? ` and style: ${stylePrompt}` : ''}`,
      );
      const response = await ai.models.generateContentStream({
        model: this.geminiTtsModel,
        config,
        contents,
      });

      const audioChunks: Buffer[] = [];

      // Process stream chunks
      for await (const chunk of response) {
        if (
          !chunk.candidates ||
          !chunk.candidates[0].content ||
          !chunk.candidates[0].content.parts
        ) {
          continue;
        }

        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
          const inlineData = chunk.candidates[0].content.parts[0].inlineData;
          const fileExtension = mime.getExtension(inlineData.mimeType || '');
          let buffer: Buffer;

          // When MIME type doesn't have a recognized extension (e.g., raw PCM),
          // we need to add WAV headers to make it playable
          if (!fileExtension) {
            buffer = this.convertToWav(
              inlineData.data || '',
              inlineData.mimeType || '',
            );
          } else {
            // For recognized formats (mp3, wav, etc.), use the data as-is
            buffer = Buffer.from(inlineData.data || '', 'base64');
          }

          audioChunks.push(buffer);
        }
      }

      if (audioChunks.length === 0) {
        throw new Error('No audio data received from Gemini TTS');
      }

      // Concatenate all audio chunks
      const finalAudioBuffer = Buffer.concat(audioChunks);

      // Save audio file
      this.logger.log(`Saving audio file to ${outputPath}`);
      await fs.writeFile(outputPath, finalAudioBuffer);

      // Get audio duration
      const durationMs = await this.estimateAudioDuration(outputPath);

      // Generate simple timestamps
      const timestamps = this.generateSimpleTimestamps(text, durationMs);

      // For now, no word boundaries from Gemini TTS
      const wordBoundaries: SubtitleWordBoundary[] = [];

      this.logger.log(
        `Generated Gemini TTS speech: ${outputPath} (${durationMs}ms)`,
      );

      return {
        audioPath: outputPath,
        durationMs,
        timestamps,
        wordBoundaries,
      };
    } catch (error) {
      this.logger.error(`Gemini TTS synthesis failed: ${error.message}`);
      this.logger.error(error.stack);
      throw new Error(`Gemini TTS synthesis failed: ${error.message}`);
    }
  }

  /**
   * List available Gemini TTS voices
   */
  listVoices(): GeminiVoice[] {
    return this.geminiVoices.map((voice) => ({
      ...voice,
      sampleUrl: `/voices/gemini/chirp3-hd-${voice.name.toLowerCase()}.wav`,
    }));
  }

  /**
   * Convert raw audio data to WAV format
   */
  private convertToWav(rawData: string, mimeType: string): Buffer {
    const options = this.parseMimeType(mimeType);
    const buffer = Buffer.from(rawData, 'base64');
    const wavHeader = this.createWavHeader(buffer.length, options);

    return Buffer.concat([wavHeader, buffer]);
  }

  /**
   * Parse MIME type to extract audio parameters
   */
  private parseMimeType(mimeType: string): WavConversionOptions {
    const [fileType, ...params] = mimeType.split(';').map((s) => s.trim());
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_mimePrefix, format] = fileType.split('/');

    const options: Partial<WavConversionOptions> = {
      numChannels: 1,
    };

    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    for (const param of params) {
      const [key, value] = param.split('=').map((s) => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }

    return options as WavConversionOptions;
  }

  /**
   * Create WAV file header
   */
  private createWavHeader(
    dataLength: number,
    options: WavConversionOptions,
  ): Buffer {
    const { numChannels, sampleRate, bitsPerSample } = options;

    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0); // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
    buffer.write('WAVE', 8); // Format
    buffer.write('fmt ', 12); // Subchunk1ID
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22); // NumChannels
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(byteRate, 28); // ByteRate
    buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
    buffer.write('data', 36); // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

    return buffer;
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
      // Rough estimation for audio file duration
      const durationSeconds =
        (stats.size * 8) /
        (GeminiTtsService.DEFAULT_SAMPLE_RATE *
          GeminiTtsService.DEFAULT_BITS_PER_SAMPLE *
          GeminiTtsService.DEFAULT_CHANNELS);
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
