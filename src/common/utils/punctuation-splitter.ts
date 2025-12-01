/**
 * Punctuation-based text splitter for TTS prosody segments
 * Splits text based on punctuation marks to create natural speech segments
 */

export interface ProsodySegment {
  text: string;
  rate: string;
  volume: string;
  pitch: string;
}

/**
 * Split text into segments based on punctuation marks
 * Each segment will maintain the punctuation that ends it
 */
export function splitByPunctuation(text: string): string[] {
  // Split by sentence-ending punctuation while keeping the punctuation with the text
  // Matches: . ! ? ; : ... (ellipsis) and combinations like !? or ?!
  const segments: string[] = [];

  // Regex pattern to split on sentence-ending punctuation
  // Handles:
  // - Single punctuation: . ! ? ; :
  // - Ellipsis: ... or …
  // - Combinations: !? ?! !! ??
  // The pattern captures text followed by punctuation marks
  const pattern = /([^.!?;:…]+(?:\.{2,}|…|[.!?;:]+(?:\s*[.!?;:]+)*))\s*/g;

  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const segment = match[1].trim();
    if (segment) {
      segments.push(segment);
    }
    lastIndex = pattern.lastIndex;
  }

  // Handle any remaining text without punctuation at the end
  const remaining = text.substring(lastIndex).trim();
  if (remaining) {
    segments.push(remaining);
  }

  // If no segments were created (no punctuation), return the whole text as one segment
  if (segments.length === 0 && text.trim()) {
    segments.push(text.trim());
  }

  return segments;
}

/**
 * Determine prosody settings based on punctuation and text content
 */
export function getProsodyFromPunctuation(text: string): {
  rate: string;
  volume: string;
  pitch: string;
} {
  const trimmedText = text.trim();

  // Check for multiple exclamation marks (very excited)
  if (/!{2,}$/.test(trimmedText) || /!\?|\?!/.test(trimmedText)) {
    return { rate: '+15%', volume: '+40%', pitch: '+15Hz' };
  }

  // Check for exclamation (excited/emphasis)
  if (trimmedText.endsWith('!')) {
    return { rate: '+10%', volume: '+30%', pitch: '+10Hz' };
  }

  // Check for question marks
  if (trimmedText.endsWith('?')) {
    return { rate: '+5%', volume: '+10%', pitch: '+15Hz' };
  }

  // Check for ellipsis (suspense/slow)
  if (/\.{2,}$/.test(trimmedText) || trimmedText.endsWith('…')) {
    return { rate: '-15%', volume: '-10%', pitch: '-5Hz' };
  }

  // Check for colon (introducing something)
  if (trimmedText.endsWith(':')) {
    return { rate: '-5%', volume: '+5%', pitch: '+0Hz' };
  }

  // Check for semicolon (pause/continuation)
  if (trimmedText.endsWith(';')) {
    return { rate: '-5%', volume: '+0%', pitch: '+0Hz' };
  }

  // Default for periods and other punctuation
  return { rate: '+0%', volume: '+0%', pitch: '+0Hz' };
}

/**
 * Convert text to prosody segments based on punctuation
 * This replaces AI-based prosody generation with deterministic punctuation-based splitting
 */
export function textToProsodySegments(narration: string): ProsodySegment[] {
  const textSegments = splitByPunctuation(narration);

  return textSegments.map((text) => {
    const prosody = getProsodyFromPunctuation(text);
    return {
      text,
      ...prosody,
    };
  });
}
