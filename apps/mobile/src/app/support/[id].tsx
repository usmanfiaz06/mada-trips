import { Redirect, useLocalSearchParams } from 'expo-router';

/** /support/{thread}: where a "Mada" notification lands (the desk links here). */
export default function SupportThreadLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/support', params: { thread: id } }} />;
}
