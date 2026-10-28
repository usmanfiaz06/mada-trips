/**
 * Places in Ask (find_places / place_details, CONNECT.md §32): the place cards' fixed words, the buttons and the
 * Google credit the cards must carry. Spread into the catalogue in en.ts; the Arabic is in ./ar/placesChat.ts.
 */
export const placesChatCopy = {
  /** Google's credit beside its data and photos (required by its terms; the brand name stays in Latin letters). */
  'chat.places.google': 'Google Maps',
  'chat.places.photoBy': 'Photo: {name}',
  'chat.places.openNow': 'Open now',
  'chat.places.closesAt': 'Open · closes {time}',
  'chat.places.closed': 'Closed',
  'chat.places.opensAt': 'Closed · opens {time}',
  'chat.places.fromHotel': '{distance} from your hotel',
  'chat.places.away': '{distance} away',
  'chat.places.m': '{m} m',
  'chat.places.km': '{km} km',
  'chat.places.price.1': 'Low prices',
  'chat.places.price.2': 'Mid-range',
  'chat.places.price.3': 'Pricey',
  'chat.places.price.4': 'Very pricey',
  'chat.places.today': 'Today: {hours}',
  'chat.places.week': 'Opening hours',
  'chat.places.noHours': 'Google has no hours for it',
  'chat.places.directions': 'Directions',
  'chat.places.call': 'Call',
  'chat.places.website': 'Website',
  'chat.places.addToPlan': 'Add to plan',
  'chat.places.pickDay': 'Which day?',
  'chat.places.day': 'Day {n} · {date}',
  'chat.places.added': 'Added to day {n}',
  /** No plan to add it to yet: the button says this in the chat instead, and Mada makes the plan. */
  'chat.places.addSay': 'Add {name} to my plan',
  /** Tapping a place in the list asks for it in full. */
  'chat.places.more': 'More about {name}',
  'chat.places.a11y.rating': '{rating} stars from {count} reviews',
} as const;
