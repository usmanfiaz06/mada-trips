import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { reportError } from '@/lib/net/report';
import { colors } from '@/theme';
import { CrashState } from './ErrorState';

/*
 * The last line: a screen that throws while drawing shows the frayed cable ("Something broke on our side. Your trips
 * are safe.") with Restart and Talk to Mada, instead of a white screen. Reported to Sentry when a DSN is set.
 * Restart reloads the web page; on a phone it clears the broken screen and opens the app from the start, with the
 * offline copy and the outbox untouched.
 */
type State = { error: Error | null; reference: string | null };

export class ErrorBoundary extends Component<{ children: ReactNode; onRestart?: () => void }, State> {
  state: State = { error: null, reference: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const reference = reportError(error, { where: 'boundary', extra: { stack: info.componentStack?.slice(0, 2000) } });
    this.setState({ reference: reference ? reference.slice(0, 8) : null });
  }

  restart = () => {
    if (Platform.OS === 'web' && typeof globalThis.location?.reload === 'function') { globalThis.location.reload(); return; }
    this.props.onRestart?.();
    this.setState({ error: null, reference: null });
    try { router.replace('/' as Href); } catch { /* the navigator is gone too: the reset above re-mounts it */ }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.sand }}>
        <CrashState onRestart={this.restart} reference={this.state.reference} />
      </View>
    );
  }
}
