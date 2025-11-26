import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

@Injectable()
export class TtsService {
  private speechConfig: sdk.SpeechConfig;

  constructor(private configService: ConfigService) {
    const key = this.configService.get<string>('AZURE_SPEECH_KEY');
    const region = this.configService.get<string>('AZURE_SPEECH_REGION');

    if (!key || !region) {
      console.warn('Azure Speech credentials not configured');
      return;
    }

    this.speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  }

  async generateSpeech(
    text: string,
    speaker: string,
    outputPath: string,
  ): Promise<{
    audioPath: string;
    durationMs: number;
    timestamps: WordTimestamp[];
  }> {
    return new Promise((resolve, reject) => {
      const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputPath);
      this.speechConfig.speechSynthesisVoiceName = speaker;

      // Request word boundary events for subtitle generation
      this.speechConfig.setProperty(
        sdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps,
        'true',
      );

      const synthesizer = new sdk.SpeechSynthesizer(
        this.speechConfig,
        audioConfig,
      );

      const timestamps: WordTimestamp[] = [];
      let totalDurationMs = 0;

      synthesizer.wordBoundary = (s, e) => {
        timestamps.push({
          word: e.text,
          startMs: e.audioOffset / 10000,
          endMs: (e.audioOffset + e.duration) / 10000,
        });
      };

      synthesizer.speakTextAsync(text, (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          totalDurationMs = result.audioDuration / 10000;
          synthesizer.close();
          resolve({
            audioPath: outputPath,
            durationMs: totalDurationMs,
            timestamps,
          });
        } else {
          synthesizer.close();
          reject(new Error(`Speech synthesis failed: ${result.errorDetails}`));
        }
      });
    });
  }

  async listVoices(): Promise<any[]> {
    try {
      return new Promise((resolve) => {
        const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig);

        const voicesList = synthesizer.getVoicesAsync();
        voicesList.then(
          (result) => {
            if (result.reason === sdk.ResultReason.VoicesListRetrieved) {
              synthesizer.close();
              resolve(result.voices);
            } else {
              synthesizer.close();
              resolve([]);
            }
          },
          () => {
            synthesizer.close();
            resolve([]);
          },
        );
      });
    } catch (error) {
      return [];
    }
  }
}
