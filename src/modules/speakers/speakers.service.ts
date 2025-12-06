import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { EdgeTTS } from 'edge-tts-universal';
import { TtsService } from '../../common/tts/tts.service';
import { GeminiTtsService } from '../../common/tts/gemini-tts.service';
import { PollinationsTtsService } from '../../common/tts/pollinations-tts.service';
import { TtsCoordinatorService } from '../../common/tts/tts-coordinator.service';
import { GenerateTtsDto, TtsProviderType } from './dto/generate-tts.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class SpeakersService {
  private readonly logger = new Logger(SpeakersService.name);

  constructor(
    private ttsService: TtsService,
    private geminiTtsService: GeminiTtsService,
    private pollinationsTtsService: PollinationsTtsService,
    private ttsCoordinator: TtsCoordinatorService,
  ) {}

  async listAvailableSpeakers() {
    try {
      const voices = await this.ttsService.listVoices();

      // Format voices with gender suffix for better display
      return voices.map((voice) => ({
        name: `${voice.shortName}-${voice.gender}`,
        shortName: voice.shortName,
        displayName: voice.displayName || voice.name,
        locale: voice.locale,
        gender: voice.gender,
        provider: 'edge-tts',
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * List Gemini TTS speakers
   */
  async listGeminiSpeakers() {
    try {
      const voices = this.geminiTtsService.listVoices();

      return voices.map((voice) => ({
        name: `${voice.name}-${voice.gender}`,
        shortName: voice.name,
        displayName: voice.name,
        locale: 'multi', // Gemini TTS voices are multilingual
        gender: voice.gender,
        provider: 'gemini-tts',
        sampleUrl: voice.sampleUrl || '',
      }));
    } catch (error) {
      this.logger.error(`Failed to list Gemini TTS voices: ${error.message}`);
      return [];
    }
  }

  /**
   * List Pollinations TTS speakers
   */
  async listPollinationsSpeakers() {
    try {
      const voices = this.pollinationsTtsService.listVoices();

      return voices.map((voice) => ({
        name: voice.name,
        shortName: voice.name,
        displayName: `${voice.name.charAt(0).toUpperCase() + voice.name.slice(1)} - ${voice.description}`,
        locale: 'en-US', // Pollinations TTS is optimized for English but works with other languages
        gender: 'Neutral', // Pollinations doesn't specify gender
        provider: 'pollinations-tts',
        description: voice.description,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list Pollinations TTS voices: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Get filtered speakers by locale
   */
  async getSpeakersByLocale(locale: string) {
    const allSpeakers = await this.listAvailableSpeakers();
    return allSpeakers.filter((speaker) =>
      speaker.locale.toLowerCase().startsWith(locale.toLowerCase()),
    );
  }

  /**
   * Get popular speakers (commonly used voices)
   */
  async getPopularSpeakers() {
    // Return some popular voices for quick access
    const popularVoiceNames = [
      'en-US-JennyNeural',
      'en-US-GuyNeural',
      'en-GB-SoniaNeural',
      'en-GB-RyanNeural',
      'zh-CN-XiaoxiaoNeural',
      'zh-CN-YunxiNeural',
      'ja-JP-NanamiNeural',
      'ja-JP-KeitaNeural',
      'ko-KR-SunHiNeural',
      'ko-KR-InJoonNeural',
      'id-ID-GadisNeural',
      'id-ID-ArdiNeural',
    ];

    const allSpeakers = await this.listAvailableSpeakers();
    return allSpeakers.filter((speaker) =>
      popularVoiceNames.includes(speaker.shortName),
    );
  }

  /**
   * Stream TTS audio preview directly to response
   */
  async streamPreview(
    speaker: string,
    text: string,
    res: Response,
  ): Promise<void> {
    try {
      // Parse voice name (remove gender suffix if present)
      const voiceName = speaker
        .replace(/-Female$/, '')
        .replace(/-Male$/, '')
        .trim();

      this.logger.log(`Streaming TTS preview for voice: ${voiceName}`);

      // Create TTS instance
      const tts = new EdgeTTS(text, voiceName, {
        rate: '+0%',
        pitch: '+0Hz',
      });

      // Synthesize and stream
      const result = await tts.synthesize();
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

      // Set response headers for audio streaming
      // Edge TTS always returns audio/mpeg (MP3) format
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      // Send audio data
      res.end(audioBuffer);
    } catch (error) {
      this.logger.error(`TTS preview failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to generate TTS preview' });
    }
  }

  /**
   * Generate TTS with custom parameters and stream for download
   */
  async generateAndDownloadTts(
    dto: GenerateTtsDto,
    res: Response,
  ): Promise<void> {
    const tmpDir = os.tmpdir();
    const timestamp = Date.now();
    const outputPath = path.join(tmpDir, `tts-${timestamp}.mp3`);

    try {
      this.logger.log(
        `Generating TTS: provider=${dto.provider}, voice=${dto.voice}, text length=${dto.text.length}`,
      );

      if (dto.provider === TtsProviderType.EDGE_TTS) {
        // Edge TTS with pitch/rate/volume controls
        const tts = new EdgeTTS(dto.text, dto.voice, {
          rate: dto.rate || '+0%',
          pitch: dto.pitch || '+0Hz',
          volume: dto.volume || '+0%',
        });

        const result = await tts.synthesize();
        const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
        await fs.writeFile(outputPath, audioBuffer);
      } else if (dto.provider === TtsProviderType.GEMINI_TTS) {
        // Gemini TTS with style instruction
        if (dto.style) {
          await this.ttsCoordinator.generateSpeechWithStyle(
            dto.text,
            dto.style,
            dto.voice,
            outputPath,
            'gemini-tts',
          );
        } else {
          await this.ttsCoordinator.generateSpeech(
            dto.text,
            dto.voice,
            outputPath,
            'gemini-tts',
            false,
          );
        }
      } else if (dto.provider === TtsProviderType.POLLINATIONS_TTS) {
        // Pollinations TTS
        await this.ttsCoordinator.generateSpeech(
          dto.text,
          dto.voice,
          outputPath,
          'pollinations-tts',
          false,
        );
      } else {
        throw new Error(`Unsupported TTS provider: ${dto.provider}`);
      }

      // Read the generated file
      const audioBuffer = await fs.readFile(outputPath);

      // Set response headers
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tts-${dto.voice}-${timestamp}.mp3"`,
      );

      // Send audio data
      res.end(audioBuffer);

      // Cleanup temp file
      await fs.unlink(outputPath).catch((err) => {
        this.logger.debug(
          `Failed to cleanup temp file ${outputPath}: ${err.message}`,
        );
      });
    } catch (error) {
      this.logger.error(`TTS generation failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to generate TTS audio' });

      // Cleanup on error
      await fs.unlink(outputPath).catch((err) => {
        this.logger.debug(
          `Failed to cleanup temp file ${outputPath}: ${err.message}`,
        );
      });
    }
  }
}
