import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Screen, useTopInset } from '@/components/Layout';
import { BannerHost, DemoSheet, TodayHeader, Wash, todayHour } from '@/components/today/common';
import { Booked } from '@/components/today/Booked';
import { DayBefore } from '@/components/today/DayBefore';
import { Home } from '@/components/today/Home';
import { InAir } from '@/components/today/InAir';
import { Landed } from '@/components/today/Landed';
import { Guest, Nothing, useLastTripLine } from '@/components/today/Nothing';
import { Cancelled, TravelDay } from '@/components/today/TravelDay';
import { useSession } from '@/lib/session';
import { registerForPush, useCarryOverGuestFlights, useTrip, useTrips } from '@/lib/trips';
import { colors } from '@/theme';

/**
 * Today follows the trip (prototype Today.jsx): nothing planned, weeks before, the day before, travel day (with the
 * leave countdown and gate changes), a predicted delay, a cancellation, in the air, landed, and back home.
 * The phase comes from the server's trip clock; the header date follows it.
 */
export default function Today() {
  const top = useTopInset();
  const status = useSession((s) => s.status);
  const scroll = useRef<ScrollView>(null);
  useCarryOverGuestFlights();
  useEffect(() => { void registerForPush(); }, [status]);
  const trips = useTrips();
  const currentId = trips.data?.currentId ?? null;
  const tripQ = useTrip(currentId);
  const lastLine = useLastTripLine();
  const trip = currentId ? tripQ.data?.trip : null;
  const clock = trip?.clock ?? trips.data?.clock ?? null;
  // Countdowns run on the server's clock: its instant when the trip was read, plus the time since (clock skew safe).
  const now = () => (trip ? Date.parse(trip.clock.now) + (Date.now() - tripQ.dataUpdatedAt) : Date.now());

  let body: React.ReactNode;
  if (status === 'guest') body = <Guest />;
  else if (!trips.data && trips.isPending) body = <View style={{ paddingTop: 80, alignItems: 'center' }}><ActivityIndicator color={colors.green} /></View>;
  else if (!trip || trip.clock.phase === 'none') body = currentId && tripQ.isPending ? <View style={{ paddingTop: 80, alignItems: 'center' }}><ActivityIndicator color={colors.green} /></View> : <Nothing pastLine={lastLine} />;
  else {
    switch (trip.clock.phase) {
      case 'booked': body = <Booked trip={trip} />; break;
      case 'daybefore': body = <DayBefore trip={trip} scrollTo={(y) => scroll.current?.scrollTo({ y: y - 8, animated: true })} />; break;
      case 'travelday': body = <TravelDay trip={trip} now={now} updatedAt={tripQ.dataUpdatedAt} />; break;
      case 'delayed': body = <TravelDay trip={trip} predicted now={now} updatedAt={tripQ.dataUpdatedAt} />; break;
      case 'cancelled': body = <Cancelled trip={trip} />; break;
      case 'inair': body = <InAir trip={trip} now={now} />; break;
      case 'landed': body = <Landed trip={trip} />; break;
      default: body = <Home trip={trip} />;
    }
  }

  return (
    <Screen>
      <Wash hour={todayHour()} />
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140, paddingTop: top + 10, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" testID="today-scroll">
        <TodayHeader clock={clock} unread={trips.data?.unread ?? 0} />
        {body}
      </ScrollView>
      <BannerHost />
      <DemoSheet />
    </Screen>
  );
}
