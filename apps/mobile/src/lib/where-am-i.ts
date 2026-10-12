import * as Location from 'expo-location';

/** Where the traveller is, once, when they ask ("Distance from: where I am now"). Null when they say no. */
export async function whereAmI(): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = await Location.requestForegroundPermissionsAsync();
    if (p.status !== 'granted') return null;
    const at = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: at.coords.latitude, lng: at.coords.longitude };
  } catch { return null; }
}
