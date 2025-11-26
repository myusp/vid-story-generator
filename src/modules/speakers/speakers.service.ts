import { Injectable } from '@nestjs/common';
import { TtsService } from '../../common/tts/tts.service';

@Injectable()
export class SpeakersService {
  constructor(private ttsService: TtsService) {}

  async listAvailableSpeakers() {
    try {
      const voices = await this.ttsService.listVoices();

      // Format voices with gender suffix for better display
      return voices.map((voice) => ({
        name: `${voice.shortName}-${voice.gender}`,
        shortName: voice.shortName,
        displayName: voice.name,
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
}
