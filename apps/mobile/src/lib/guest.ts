import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { firstNameOf, type CreatePersonRequest, type GuestTraveller, type Person } from '@mada/shared';

/*
 * Looking around without an account (Apple 5.1.1(v)). A guest searches, sees real prices, opens hotels, plans and
 * Discover; the people they say are going live only on this phone (ids made here, no passports), and the server
 * prices for them without keeping anything personal. Signing in to book carries them onto the account
 * (carryOverGuestPeople), so the search and the option picked survive the sign-in.
 */

const KEY = 'mada.guest.people.v1';
const web = Platform.OS === 'web';

const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

function selfPerson(): Person {
  return { id: uuid(), isSelf: true, givenNames: '', surname: '', firstName: '', relation: 'self', dateOfBirth: null, sex: null, nationality: null, passport: null, createdAt: new Date().toISOString() };
}

let people: Person[] = [];
function readWeb(): Person[] {
  try { const raw = globalThis.localStorage?.getItem(KEY); return raw ? (JSON.parse(raw) as Person[]) : []; } catch { return []; }
}
function save() {
  const raw = JSON.stringify(people);
  try {
    if (web) globalThis.localStorage?.setItem(KEY, raw);
    else void AsyncStorage.setItem(KEY, raw).catch(() => {});
  } catch { /* private mode: they last this session */ }
}
if (web) people = readWeb();
let loaded: Promise<void> | null = web ? Promise.resolve() : null;
const load = () => (loaded ??= AsyncStorage.getItem(KEY).then((raw) => { if (raw) people = JSON.parse(raw) as Person[]; }).catch(() => {}));

/** The guest's household: themselves first (made on first use), then whoever they added while searching. */
export async function guestPeople(): Promise<Person[]> {
  await load();
  if (!people.some((p) => p.isSelf)) { people = [selfPerson(), ...people]; save(); }
  return people;
}

/** Someone added in "Who's going?" without an account: kept on this phone. */
export async function addGuestPerson(p: CreatePersonRequest): Promise<Person> {
  await guestPeople();
  const person: Person = {
    id: uuid(), isSelf: false, givenNames: p.givenNames, surname: p.surname, firstName: firstNameOf(p.givenNames), relation: p.relation,
    dateOfBirth: p.dateOfBirth ?? null, sex: p.sex ?? null, nationality: p.nationality ?? null, passport: null, createdAt: new Date().toISOString(),
  };
  people = [...people, person];
  save();
  return person;
}

/** What the server needs to price these people for a guest: the phone's ids and their ages, nothing else. */
export function guestTravellers(ids: string[]): GuestTraveller[] {
  return ids.map((id) => { const p = people.find((x) => x.id === id); return { id, dateOfBirth: p?.dateOfBirth ?? null, isSelf: !!p?.isSelf }; });
}

/** How many a guest's plans are priced for: the people they've added, else two. */
export const guestPartySize = () => Math.min(9, people.length > 1 ? people.length : 2);

export const isGuestId = (id: string) => people.some((p) => p.id === id);

/**
 * Signed in now: the people the guest added become the account's (matched by name first, so nobody is added
 * twice), the guest themselves becomes the account holder. Returns guest id → account id, for the saved search.
 */
export async function carryOverGuestPeople(account: { people: () => Promise<{ people: Person[] }>; addPerson: (p: CreatePersonRequest) => Promise<{ person: Person }> }): Promise<Map<string, string>> {
  await load();
  const map = new Map<string, string>();
  if (!people.length) return map;
  const mine = (await account.people()).people;
  for (const g of people) {
    const same = g.isSelf ? mine.find((p) => p.isSelf) : mine.find((p) => !p.isSelf && p.givenNames.trim().toLowerCase() === g.givenNames.trim().toLowerCase());
    if (same) { map.set(g.id, same.id); continue; }
    const { person } = await account.addPerson({ givenNames: g.givenNames, surname: g.surname, relation: g.relation === 'self' ? 'family' : g.relation, ...(g.dateOfBirth ? { dateOfBirth: g.dateOfBirth } : {}) });
    map.set(g.id, person.id);
  }
  people = [];
  save();
  carried = new Map([...carried, ...map]);
  writeCarried();
  return map;
}

/** Guest ids already moved to the account (kept, so a link opened later with guest ids still books for the right people). */
const CARRIED_KEY = 'mada.guest.carried.v1';
let carried = new Map<string, string>();
try { if (web) carried = new Map(JSON.parse(globalThis.localStorage?.getItem(CARRIED_KEY) ?? '[]') as [string, string][]); } catch { /* none */ }
if (!web) void AsyncStorage.getItem(CARRIED_KEY).then((raw) => { if (raw) carried = new Map([...(JSON.parse(raw) as [string, string][]), ...carried]); }).catch(() => {});
function writeCarried() {
  const raw = JSON.stringify([...carried]);
  try { if (web) globalThis.localStorage?.setItem(CARRIED_KEY, raw); else void AsyncStorage.setItem(CARRIED_KEY, raw).catch(() => {}); } catch { /* */ }
}

/** These ids as the account knows them: guest people are carried over first (once), then mapped. */
export async function accountIds(ids: string[], account: Parameters<typeof carryOverGuestPeople>[0]): Promise<string[]> {
  await load();
  if (ids.some((id) => people.some((p) => p.id === id))) await carryOverGuestPeople(account);
  const mapped = ids.map((id) => carried.get(id) ?? id);
  if (mapped.length) return mapped;
  // Nobody named (a shared link): the account holder.
  const self = (await account.people()).people.find((p) => p.isSelf);
  return self ? [self.id] : [];
}
