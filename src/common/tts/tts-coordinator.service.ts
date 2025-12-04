import { Injectable, Logger } from '@nestjs/common';
import { TtsService } from './tts.service';
import { GeminiTtsService } from './gemini-tts.service';
import type { WordTimestamp, SubtitleWordBoundary } from './tts.service';
import type { ProsodySegment } from './tts.service';

export type TtsProvider = 'edge-tts' | 'gemini-tts';

@Injectable()
export class TtsCoordinatorService {
  private readonly logger = new Logger(TtsCoordinatorService.name);

  constructor(
    private edgeTtsService: TtsService,
    private geminiTtsService: GeminiTtsService,
  ) {}

  /**
   * Generate speech using the specified TTS provider
   */
  async generateSpeech(
    text: string,
    speaker: string,
    outputPath: string,
    provider: TtsProvider = 'edge-tts',
    useSsml: boolean = false,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
    wordBoundaries: SubtitleWordBoundary[];
  }> {
    this.logger.log(
      `Generating speech using ${provider} provider with voice: ${speaker}`,
    );

    if (provider === 'gemini-tts') {
      return await this.geminiTtsService.generateSpeech(
        text,
        speaker,
        outputPath,
      );
    } else {
      return await this.edgeTtsService.generateSpeech(
        text,
        speaker,
        outputPath,
        useSsml,
      );
    }
  }

  /**
   * Generate speech with prosody segments (only supported by Edge TTS)
   */
  async generateSpeechWithProsody(
    segments: ProsodySegment[],
    speaker: string,
    outputPath: string,
    provider: TtsProvider = 'edge-tts',
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
    wordBoundaries: SubtitleWordBoundary[];
  }> {
    this.logger.log(
      `Generating speech with prosody using ${provider} provider`,
    );

    if (provider === 'gemini-tts') {
      // Gemini TTS doesn't support prosody segments, so concatenate text and use regular generation
      const fullText = segments.map((s) => s.text).join(' ');
      this.logger.warn(
        'Gemini TTS does not support prosody segments, using regular generation',
      );
      return await this.geminiTtsService.generateSpeech(
        fullText,
        speaker,
        outputPath,
      );
    } else {
      return await this.edgeTtsService.generateSpeechWithProsody(
        segments,
        speaker,
        outputPath,
      );
    }
  }

  /**
   * List available voices for the specified provider
   */
  async listVoices(provider: TtsProvider = 'edge-tts') {
    if (provider === 'gemini-tts') {
      return this.geminiTtsService.listVoices();
    } else {
      return await this.edgeTtsService.listVoices();
    }
  }
}
