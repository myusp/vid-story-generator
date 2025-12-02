import {
  splitByPunctuation,
  getProsodyFromPunctuation,
  textToProsodySegments,
} from './punctuation-splitter';

describe('punctuation-splitter', () => {
  describe('splitByPunctuation', () => {
    it('should split text by periods', () => {
      const text = 'Hello world. This is a test.';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['Hello world.', 'This is a test.']);
    });

    it('should split text by exclamation marks', () => {
      const text = 'Wow! Amazing!';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['Wow!', 'Amazing!']);
    });

    it('should split text by question marks', () => {
      const text = 'How are you? What is this?';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['How are you?', 'What is this?']);
    });

    it('should handle mixed punctuation', () => {
      const text = 'Hello! How are you? I am fine.';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['Hello!', 'How are you?', 'I am fine.']);
    });

    it('should handle ellipsis', () => {
      const text = 'Wait for it... And here it comes!';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['Wait for it...', 'And here it comes!']);
    });

    it('should return whole text if no punctuation', () => {
      const text = 'Hello world';
      const result = splitByPunctuation(text);
      expect(result).toEqual(['Hello world']);
    });

    it('should handle empty string', () => {
      const text = '';
      const result = splitByPunctuation(text);
      expect(result).toEqual([]);
    });
  });

  describe('getProsodyFromPunctuation', () => {
    it('should return excited prosody for exclamation marks', () => {
      const result = getProsodyFromPunctuation('Wow!');
      expect(result.rate).toBe('+3%');
      expect(result.volume).toBe('+10%');
      expect(result.pitch).toBe('+3Hz');
    });

    it('should return very excited prosody for multiple exclamation marks', () => {
      const result = getProsodyFromPunctuation('Amazing!!');
      expect(result.rate).toBe('+5%');
      expect(result.volume).toBe('+15%');
      expect(result.pitch).toBe('+5Hz');
    });

    it('should return question prosody for question marks', () => {
      const result = getProsodyFromPunctuation('Really?');
      expect(result.rate).toBe('+2%');
      expect(result.volume).toBe('+5%');
      expect(result.pitch).toBe('+5Hz');
    });

    it('should return slow prosody for ellipsis', () => {
      const result = getProsodyFromPunctuation('Wait...');
      expect(result.rate).toBe('-5%');
      expect(result.volume).toBe('-3%');
      expect(result.pitch).toBe('-2Hz');
    });

    it('should return default prosody for periods', () => {
      const result = getProsodyFromPunctuation('Normal sentence.');
      expect(result.rate).toBe('+0%');
      expect(result.volume).toBe('+0%');
      expect(result.pitch).toBe('+0Hz');
    });
  });

  describe('textToProsodySegments', () => {
    it('should convert text to prosody segments', () => {
      const text = 'Hello! How are you?';
      const result = textToProsodySegments(text);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('Hello!');
      expect(result[0].rate).toBe('+3%');
      expect(result[1].text).toBe('How are you?');
      expect(result[1].rate).toBe('+2%');
    });

    it('should handle single sentence', () => {
      const text = 'This is a test.';
      const result = textToProsodySegments(text);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('This is a test.');
      expect(result[0].rate).toBe('+0%');
    });
  });
});
