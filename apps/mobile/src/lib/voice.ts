import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { getLocale } from './i18n';

export type VoiceProblem = 'denied' | 'none' | 'unsupported' | 'failed';

/**
 * Speak instead of type: the phone's own speech recognition (Apple, Google) or the browser's on the web. Words appear
 * as they're heard; nothing is recorded or kept. Arabic is heard as Saudi Arabic.
 */
export function useVoice({ onText, onProblem }: { onText: (text: string, final: boolean) => void; onProblem: (p: VoiceProblem) => void }) {
  const [listening, setListening] = useState(false);
  const heard = useRef(false);
  const live = useRef({ onText, onProblem });
  useEffect(() => { live.current = { onText, onProblem }; });

  useSpeechRecognitionEvent('start', () => { heard.current = false; setListening(true); });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    if (!heard.current) live.current.onProblem('none');
  });
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript?.trim() ?? '';
    if (!text) return;
    heard.current = true;
    live.current.onText(text, e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    heard.current = true; // the problem below says what happened; don't also say "we didn't catch that"
    setListening(false);
    if (e.error === 'aborted') return;
    live.current.onProblem(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'speech-timeout' ? 'none' : 'failed');
  });

  useEffect(() => () => { try { ExpoSpeechRecognitionModule.abort(); } catch { /* not started */ } }, []);

  const start = useCallback(async () => {
    let available = false;
    try { available = ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { available = false; }
    if (!available) { onProblem('unsupported'); return; }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) { onProblem('denied'); return; }
      ExpoSpeechRecognitionModule.start({
        lang: getLocale() === 'ar' ? 'ar-SA' : 'en-US',
        interimResults: true,
        continuous: false,
        addsPunctuation: Platform.OS !== 'web',
      });
    } catch {
      onProblem('failed');
    }
  }, [onProblem]);

  const stop = useCallback(() => { try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ } }, []);

  return { listening, start, stop };
}
