import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { EdgeTTS } from 'edge-tts-universal';
import { TtsService } from '../../common/tts/tts.service';

@Injectable()
export class SpeakersService {
  private readonly logger = new Logger(SpeakersService.name);

  constructor(private ttsService: TtsService) {}

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
      }));
    } catch (error) {
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
}
