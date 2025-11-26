import { Injectable } from '@nestjs/common';
import { TtsService } from '../../common/tts/tts.service';

@Injectable()
export class SpeakersService {
  constructor(private ttsService: TtsService) {}

  async listAvailableSpeakers() {
    try {
      const voices = await this.ttsService.listVoices();
      return voices.map((voice) => ({
        name: voice.shortName,
        displayName: voice.displayName,
        locale: voice.locale,
        gender: voice.gender,
      }));
    } catch (error) {
      return [];
    }
  }
}
