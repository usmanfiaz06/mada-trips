import { Redirect, useLocalSearchParams } from 'expo-router';

/** The desk's notifications link a request as /requests/{id}: open its thread. */
export default function RequestLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/ask/request/[id]', params: { id: String(id ?? '') } }} />;
}
