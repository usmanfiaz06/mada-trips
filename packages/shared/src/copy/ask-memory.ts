/**
 * What Mada remembers (docs/app/ASK-CHAT.md §7): Account → What Mada remembers, the line Ask adds when it saves
 * something, and the "New chat" action. Spread into the catalogue in en.ts.
 */
export const askMemoryCopy = {
  'memory.title': 'What Mada remembers',
  'memory.intro': 'Small things you told Ask Mada, so the next trip starts right. Only you see them, and you can remove any of them.',
  'memory.empty': 'Nothing yet. Tell Ask Mada something lasting, like an aisle seat or flying from Jeddah, and it shows here.',
  'memory.group': 'From your chats',
  'memory.kind.home_airport': 'Home airport',
  'memory.kind.airline': 'Airline',
  'memory.kind.cabin': 'Cabin',
  'memory.kind.seat': 'Seat',
  'memory.kind.budget': 'Budget',
  'memory.kind.food': 'Food',
  'memory.kind.mobility': 'Getting around',
  'memory.kind.health': 'Health',
  'memory.kind.family': 'Family',
  'memory.kind.contact': 'Reaching you',
  'memory.kind.other': 'Good to know',
  'memory.source.chat': 'Said in Ask · {date}',
  'memory.source.booking': 'From a booking · {date}',
  'memory.remove': 'Remove',
  'memory.remove.a11y': 'Remove “{text}”',
  'memory.removed': 'Removed. Ask Mada won’t use it again.',
  'memory.forgetAll': 'Forget everything',
  'memory.forgetAll.title': 'Forget everything Mada remembers?',
  'memory.forgetAll.body': 'Ask Mada starts fresh next time. Your trips, bookings and household stay as they are.',
  'memory.forgetAll.keep': 'Keep them',
  'memory.forgetAll.done': 'Done. Ask Mada starts fresh.',
  'memory.footer': 'Ask Mada also looks at your recent searches, saved places and trips when it answers. Those stay on their own screens.',
  'profile.memory': 'What Mada remembers',
  'profile.memorySub': 'Seats, airports and needs from your chats',
  'privacy.keep.memory': 'What Ask Mada remembers',
  'privacy.keep.memoryWhy': 'Things you told Ask Mada, like a seat or your home airport, so you don’t repeat them. Health or mobility needs only after you say yes. See or remove them any time.',
  /** Added once to Ask's reply on the turn something was saved. */
  'chat.remembered': 'We’ll remember that for next time.',
  /** Starts a fresh conversation in Ask (the last one is kept on the phone for 24 hours). */
  'chat.newChat': 'New chat',
  'chat.newChat.a11y': 'Start a new chat',
} as const;
