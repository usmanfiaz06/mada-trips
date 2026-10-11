import { Redirect, useLocalSearchParams } from 'expo-router';

/** madatrips.sa/i/<code>: the short form of an invite link. Same as /join/<code>. */
export default function ShortInvite() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/join/${encodeURIComponent(code)}`} />;
}
