import { z } from 'zod';
import { AirportCode, HalalasAmount, Id, IsoDateTime, IsoDay, PhoneE164 } from './common';
import { Credit } from './commerce';
import { PassportInput, Person, Sex } from './people';
import { MessageAuthor } from './social';

export * from '../mrz';

/*
 * The Wallet and the account around it (M1): documents, the household's details, passports from a scan,
 * Mada credit, saved cards, support with Faisal and the 24/7 desk, account settings, privacy and deletion.
 * Everything sensitive leaves the server masked; files never have a public URL.
 */

export const WALLET_ROUTES = {
  documents: '/documents',
  document: '/documents/:id',
  documentFile: '/documents/:id/file',
  documentShare: '/documents/:id/share',
  person: '/people/:id',
  personPassport: '/people/:id/passport',
  passport: '/passport',
  account: '/account',
  accountPhoto: '/account/photo',
  accountDevices: '/account/devices',
  accountDevice: '/account/devices/:id',
  accountSignOutEverywhere: '/account/devices/signout-all',
  accountDeletion: '/account/deletion',
  emailStart: '/me/email/start',
  emailVerify: '/me/email/verify',
  phoneStart: '/me/phone/start',
  phoneVerify: '/me/phone/verify',
  methods: '/me/methods/:provider',
  consents: '/consents',
  export: '/export',
  cards: '/cards',
  card: '/cards/:id',
  cardsDefault: '/cards/default',
  credit: '/credit',
  creditMove: '/credit/move',
  supportThreads: '/support/threads',
  supportThread: '/support/threads/:id',
  supportMessages: '/support/threads/:id/messages',
  supportAttachments: '/support/threads/:id/attachments',
  supportAttachment: '/support/attachments/:id',
  supportRead: '/support/threads/:id/read',
  supportUnread: '/support/unread',
} as const;

/** "/documents/:id" + { id } → "/documents/7b…". */
export function walletPath(route: keyof typeof WALLET_ROUTES, params: Record<string, string> = {}): string {
  return WALLET_ROUTES[route].replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
}

/* ───────────── files ───────────── */

/** Photos and PDFs, up to 10 MB (FLOWS.md §8c). HEIC is what an iPhone camera saves. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'] as const;
export const UploadType = z.enum(UPLOAD_TYPES);
export type UploadType = z.infer<typeof UploadType>;

/** What's wrong with a file before it's sent, as a catalogue key, or null when it's fine. */
export function checkUpload(f: { type?: string | null; size?: number | null; name?: string | null }, opts: { photosOnly?: boolean } = {}):
  null | 'wallet.upload.wrongType' | 'wallet.upload.tooBig' | 'wallet.upload.photoOnly' {
  const type = (f.type ?? '').toLowerCase();
  const byName = /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name ?? '') ? 'image' : /\.pdf$/i.test(f.name ?? '') ? 'pdf' : null;
  const isPdf = type === 'application/pdf' || (!type && byName === 'pdf');
  const isImage = (UPLOAD_TYPES as readonly string[]).includes(type) ? type.startsWith('image/') : !type && byName === 'image';
  if (opts.photosOnly && isPdf) return 'wallet.upload.photoOnly';
  if (!isImage && !isPdf) return 'wallet.upload.wrongType';
  if ((f.size ?? 0) > UPLOAD_MAX_BYTES) return 'wallet.upload.tooBig';
  return null;
}

export const FileInfo = z.object({ id: Id, name: z.string(), mime: z.string(), size: z.number().int().nonnegative() });
export type FileInfo = z.infer<typeof FileInfo>;

/* ───────────── documents ───────────── */

export const DocumentKind = z.enum(['passport', 'visa', 'national_id', 'iqama', 'exit_reentry', 'insurance', 'other']);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const WalletDocument = z.object({
  id: Id,
  personId: Id,
  kind: DocumentKind,
  /** "Schengen visa", "National ID", "Travel insurance". */
  title: z.string(),
  /** One line under the title: "Multi-entry until Jun 2028". */
  detail: z.string(),
  validUntil: IsoDay.nullable(),
  /** What was read from it and shown back before saving (never a full passport or ID number). */
  fields: z.record(z.string(), z.string()),
  file: FileInfo.nullable(),
  source: z.enum(['scan', 'upload', 'setup', 'manual']),
  /** Added when the account was set up by Mada: removed by asking Faisal. */
  removable: z.boolean(),
  /** While Faisal can see it for a trip. */
  sharedUntil: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WalletDocument = z.infer<typeof WalletDocument>;

/** The metadata part of an upload (multipart field "meta", JSON). The file itself is the "file" part. */
export const CreateDocumentMeta = z.object({
  personId: Id,
  kind: DocumentKind,
  title: z.string().trim().min(1).max(80).optional(),
  detail: z.string().trim().max(120).optional(),
  validUntil: IsoDay.optional(),
  fields: z.record(z.string().max(40), z.string().max(120)).optional(),
  source: z.enum(['scan', 'upload', 'manual']).default('upload'),
  /** Replace this document: the old one is removed once the new one is saved. */
  replaces: Id.optional(),
});
export type CreateDocumentMeta = z.input<typeof CreateDocumentMeta>;

export const DocumentsResponse = z.object({ documents: z.array(WalletDocument) });
export const DocumentResponse = z.object({ document: WalletDocument });

/** Share with Faisal for one trip: read-only, no download, ends with the trip (or the date given). */
export const ShareDocumentRequest = z.object({ tripId: Id.optional(), until: IsoDay.optional() });
export const DocumentGrant = z.object({ id: Id, documentId: Id, tripId: Id.nullable(), expiresAt: IsoDateTime, revokedAt: IsoDateTime.nullable(), createdAt: IsoDateTime });
export type DocumentGrant = z.infer<typeof DocumentGrant>;
export const DocumentGrantResponse = z.object({ grant: DocumentGrant });

/* ───────────── household details ───────────── */

/** The words people use (Son, Daughter, Sibling), on top of the booking relation. */
export const RELATION_LABELS = ['Spouse', 'Son', 'Daughter', 'Parent', 'Sibling', 'Relative', 'Friend', 'Helper', 'Colleague'] as const;
export const RelationLabel = z.enum(RELATION_LABELS);
export const MEALS = ['halal', 'veg', 'vegan', 'child', 'diabetic', 'gluten', 'lowsalt'] as const;
export const Meal = z.enum(MEALS);
export type Meal = z.infer<typeof Meal>;

/** Iqama numbers: 10 digits starting with 2 (Saudi ID numbers start with 1). */
export const IqamaNumber = z.string().regex(/^2\d{9}$/, 'An iqama number has 10 digits and starts with 2');
export const ExitVisa = z.object({ kind: z.enum(['none', 'single', 'multiple']), until: IsoDay.nullable() });
export type ExitVisa = z.infer<typeof ExitVisa>;

export const PersonDetails = z.object({
  relationLabel: RelationLabel.nullable(),
  meal: Meal.nullable(),
  /** "2•••••4561": the iqama only ever leaves masked. */
  iqamaMasked: z.string().nullable(),
  iqamaAt: IsoDateTime.nullable(),
  exitVisa: ExitVisa,
});
export type PersonDetails = z.infer<typeof PersonDetails>;

export const PersonDetailResponse = z.object({ person: Person, details: PersonDetails });
export type PersonDetailResponse = z.infer<typeof PersonDetailResponse>;

export const UpdatePersonRequest = z.object({
  relationLabel: RelationLabel,
  meal: Meal,
  iqama: IqamaNumber.nullable(),
  exitVisa: ExitVisa,
}).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdatePersonRequest = z.input<typeof UpdatePersonRequest>;

const NamePart = z.string().trim().min(1).max(60);
/** A passport read from the photo page (or typed): the names come with it, exactly as printed. */
export const SavePassportRequest = z.object({
  givenNames: NamePart,
  surname: NamePart,
  dateOfBirth: IsoDay,
  sex: Sex.optional(),
  passport: PassportInput,
});
export type SavePassportRequest = z.input<typeof SavePassportRequest>;

/* ───────────── account ───────────── */

export const LOYALTY_PROGRAMS = [
  { id: 'alfursan', name: 'Saudia Alfursan', kind: 'airline', re: /^\d{8,10}$/, hint: '8 to 10 digits, on your Alfursan card' },
  { id: 'nasmiles', name: 'flynas nasmiles', kind: 'airline', re: /^\d{10}$/, hint: '10 digits' },
  { id: 'mands', name: 'Turkish Miles&Smiles', kind: 'airline', re: /^(TK)?\d{9}$/, hint: '9 digits, sometimes with TK in front' },
  { id: 'skywards', name: 'Emirates Skywards', kind: 'airline', re: /^(EK)?\d{9}$/, hint: '9 digits, sometimes with EK in front' },
  { id: 'bonvoy', name: 'Marriott Bonvoy', kind: 'hotel', re: /^\d{9}$/, hint: '9 digits' },
  { id: 'hilton', name: 'Hilton Honors', kind: 'hotel', re: /^\d{9,10}$/, hint: '9 or 10 digits' },
  { id: 'ihg', name: 'IHG One Rewards', kind: 'hotel', re: /^\d{9}$/, hint: '9 digits' },
  { id: 'accor', name: 'Accor ALL', kind: 'hotel', re: /^3081\d{12}$/, hint: '16 digits, starting 3081' },
] as const;
export type LoyaltyProgramId = (typeof LOYALTY_PROGRAMS)[number]['id'];
export const LoyaltyProgram = z.enum(LOYALTY_PROGRAMS.map((p) => p.id) as [LoyaltyProgramId, ...LoyaltyProgramId[]]);
export const normLoyalty = (v: string) => v.toUpperCase().replace(/[\s-]/g, '');
export const LoyaltyNumber = z.object({ id: z.string().min(1).max(40), program: LoyaltyProgram, number: z.string().max(24) })
  .refine((l) => LOYALTY_PROGRAMS.find((p) => p.id === l.program)!.re.test(normLoyalty(l.number)), { message: 'That number doesn’t match the programme', path: ['number'] });

export const ASSISTANCE = ['wchr', 'wchc', 'infant', 'bassinet'] as const;
export const Currency = z.enum(['SAR', 'AED', 'USD', 'EUR', 'GBP']);

export const TravelPrefs = z.object({
  seat: z.enum(['window', 'aisle', 'any']),
  together: z.boolean(),
  meal: Meal,
  assist: z.array(z.enum(ASSISTANCE)).max(4),
  loyalty: z.array(LoyaltyNumber).max(16),
  notes: z.string().max(280),
}).refine((p) => !(p.assist.includes('wchr') && p.assist.includes('wchc')), { message: 'One wheelchair option', path: ['assist'] })
  .refine((p) => !p.assist.includes('bassinet') || p.assist.includes('infant'), { message: 'A bassinet needs an infant', path: ['assist'] })
  .refine((p) => new Set(p.loyalty.map((l) => l.program)).size === p.loyalty.length, { message: 'One number per programme', path: ['loyalty'] });
export type TravelPrefs = z.infer<typeof TravelPrefs>;

export const Consents = z.object({ marketing: z.boolean(), analytics: z.boolean() });
export type Consents = z.infer<typeof Consents>;

export const Account = z.object({
  /** What Mada calls you, if different from the first name on the passport. */
  preferredName: z.string().nullable(),
  preferredAt: IsoDateTime.nullable(),
  home: AirportCode,
  homeAt: IsoDateTime.nullable(),
  currency: Currency,
  arabicNotify: z.boolean(),
  prefs: TravelPrefs,
  /** The Wallet asks for Face ID (or the passcode) before it opens. */
  faceId: z.boolean(),
  consents: Consents,
  photo: z.object({ updatedAt: IsoDateTime }).nullable(),
  emailVerifiedAt: IsoDateTime.nullable(),
  phoneVerifiedAt: IsoDateTime.nullable(),
  /** When the account will be deleted, if the person asked for it. */
  deleteAt: IsoDateTime.nullable(),
  exportRequestedAt: IsoDateTime.nullable(),
});
export type Account = z.infer<typeof Account>;
export const AccountResponse = z.object({ account: Account });

export const UpdateAccountRequest = z.object({
  preferredName: z.string().trim().min(1).max(30).regex(/^[^0-9@#$%^*_=+<>{}[\]\\|]+$/, 'Letters only').nullable(),
  home: AirportCode,
  currency: Currency,
  arabicNotify: z.boolean(),
  prefs: TravelPrefs,
  faceId: z.boolean(),
}).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateAccountRequest = z.input<typeof UpdateAccountRequest>;

export const Device = z.object({
  id: Id,
  name: z.string(),
  platform: z.string().nullable(),
  current: z.boolean(),
  lastUsedAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type Device = z.infer<typeof Device>;
export const DevicesResponse = z.object({ devices: z.array(Device) });

export const EmailStartRequest = z.object({ email: z.email().max(254) });
export const EmailVerifyRequest = z.object({ email: z.email().max(254), code: z.string().regex(/^\d{6}$/) });
export const PhoneStartRequest = z.object({ phone: z.string().min(5).max(20) });
export const PhoneVerifyRequest = z.object({ phone: z.string().min(5).max(20), code: z.string().regex(/^\d{6}$/) });
export const LinkMethodRequest = z.object({ idToken: z.string().min(8).max(4096), nonce: z.string().max(200).optional() });
export const CodeSentResponse = z.object({ to: z.string(), resendAfter: z.number().int(), expiresIn: z.number().int() });

export const ConsentEvent = z.object({ consent: z.enum(['marketing', 'analytics']), granted: z.boolean(), at: IsoDateTime });
export const ConsentsResponse = z.object({ consents: Consents, history: z.array(ConsentEvent) });
export const UpdateConsentsRequest = Consents.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const DeletionResponse = z.object({ deleteAt: IsoDateTime.nullable() });
export const DeletionRequest = z.object({ confirm: z.literal('DELETE') });

export const ExportStatus = z.object({
  id: Id,
  status: z.enum(['pending', 'ready', 'sent', 'expired']),
  email: z.string(),
  requestedAt: IsoDateTime,
  readyAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type ExportStatus = z.infer<typeof ExportStatus>;
export const ExportResponse = z.object({ export: ExportStatus.nullable() });

/* ───────────── cards and credit ───────────── */

export const CardBrand = z.enum(['visa', 'mastercard', 'mada']);
export type CardBrand = z.infer<typeof CardBrand>;
export const SavedCard = z.object({
  id: Id,
  brand: CardBrand,
  /** "Visa ending 41" */
  label: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  /** "08/28" */
  exp: z.string().regex(/^\d{2}\/\d{2}$/),
  createdAt: IsoDateTime,
});
export type SavedCard = z.infer<typeof SavedCard>;
/** The default is a saved card's id, or Apple Pay. */
export const DefaultMethod = z.union([Id, z.literal('applepay')]);
export const CardsResponse = z.object({ cards: z.array(SavedCard), defaultId: DefaultMethod });
export type CardsResponse = z.infer<typeof CardsResponse>;
/** Card numbers never reach Mada: the app sends the payment provider's token and what's printed on the front. */
export const AddCardRequest = z.object({
  token: z.string().min(6).max(400),
  brand: CardBrand,
  last4: z.string().regex(/^\d{4}$/),
  exp: z.string().regex(/^\d{2}\/\d{2}$/),
  makeDefault: z.boolean().default(true),
});
export type AddCardRequest = z.input<typeof AddCardRequest>;
export const SetDefaultCardRequest = z.object({ id: DefaultMethod });

export const CreditResponse = z.object({ credit: Credit });
export const MoveCreditRequest = z.object({ cardId: Id });
export const MoveCreditResponse = z.object({ credit: Credit, moved: HalalasAmount, to: z.string() });

/* ───────────── support ───────────── */

export const SUPPORT_TOPICS = ['change', 'refund', 'bag', 'docs', 'airport', 'other'] as const;
export const SupportTopic = z.enum(SUPPORT_TOPICS);
export type SupportTopic = z.infer<typeof SupportTopic>;
export const SupportIntent = z.enum(['urgent', 'bag', 'missed', 'refund', 'seat', 'change', 'docs', 'airport', 'other', 'photo', 'free']);
export type SupportIntent = z.infer<typeof SupportIntent>;

/** What a message is about. Order matters: someone hurt beats a lost bag (prototype Support.jsx). */
export function supportIntent(text: string): SupportIntent {
  const t = (text || '').toLowerCase();
  if (/\b(emergency|urgent|ambulance|hospital|medical|doctor|injured|injury|hurt|bleeding|collapsed|police|stolen|robbed|unwell|chest pain)\b|^\s*help\b|help me|lost (my |our |her |his )?passport/.test(t)) return 'urgent';
  if (/\b(bag|bags|luggage|suitcase|baggage)\b/.test(t)) return 'bag';
  if (/missed|cancell?ed|cancel my flight|flight (was |is |got )?(cancel|delay)|delayed|rebook|stuck at|didn'?t (let|board)/.test(t)) return 'missed';
  if (/refund|charged|charge|payment|paid twice|money back|double|deducted/.test(t)) return 'refund';
  if (/window|aisle|\bseats?\b|sit (by|next|together)/.test(t)) return 'seat';
  if (/change|move (my|the|our)|different (date|day|flight)|reschedul/.test(t)) return 'change';
  if (/visa|passport|document|iqama/.test(t)) return 'docs';
  if (/airport|gate|check[- ]?in|counter/.test(t)) return 'airport';
  return 'free';
}

/** The extras a message can carry: a call button, choices, the bag form, next steps, a refund's state. */
export const SupportCard = z.object({
  intent: SupportIntent.optional(),
  urgent: z.boolean().optional(),
  choices: z.array(z.object({ label: z.string(), key: z.string() })).optional(),
  picked: z.string().optional(),
  form: z.literal('bag').optional(),
  filed: z.boolean().optional(),
  steps: z.array(z.string()).optional(),
  action: z.object({ label: z.string(), to: z.string() }).optional(),
  resolved: z.boolean().optional(),
  rated: z.boolean().optional(),
  refund: z.object({ amount: HalalasAmount, title: z.string(), stage: z.string(), card: z.string() }).optional(),
});
export type SupportCard = z.infer<typeof SupportCard>;

export const SupportMessage = z.object({
  id: Id,
  threadId: Id,
  author: MessageAuthor,
  body: z.string(),
  card: SupportCard.nullable(),
  attachment: FileInfo.nullable(),
  /** The app's own id for a message written offline, so a resend never doubles it. */
  clientId: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type SupportMessage = z.infer<typeof SupportMessage>;

export const SupportThread = z.object({
  id: Id,
  tripId: Id.nullable(),
  /** "Istanbul trip · 9–15 Mar" or "Your account". */
  about: z.string(),
  status: z.enum(['open', 'closed']),
  unread: z.number().int().nonnegative(),
  lastMessageAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type SupportThread = z.infer<typeof SupportThread>;

export const OpenThreadRequest = z.object({ tripId: Id.optional(), about: z.string().trim().min(1).max(80).optional() });
export const SupportThreadsResponse = z.object({ threads: z.array(SupportThread) });
export const SupportThreadResponse = z.object({ thread: SupportThread, messages: z.array(SupportMessage) });
export type SupportThreadResponse = z.infer<typeof SupportThreadResponse>;
export const BagReport = z.object({ ref: z.string().trim().min(5).max(30), kind: z.string().max(40), to: z.string().max(40) });
export const SendSupportMessageRequest = z.object({
  body: z.string().trim().max(4000),
  clientId: z.string().min(4).max(64).optional(),
  /** A topic chip, so the answer fits it even when the words are short. */
  topic: SupportTopic.optional(),
  /** Answering a message's choices. */
  reply: z.object({ messageId: Id, choice: z.string().max(40) }).optional(),
  /** The bag form, filled in (or `none: true`: no reference yet). */
  bag: z.union([BagReport, z.object({ messageId: Id, none: z.literal(true) })]).optional(),
  bagFor: Id.optional(),
  /** "Did that sort it?" */
  rating: z.enum(['yes', 'not_yet']).optional(),
}).refine((m) => m.body.length > 0 || !!m.reply || !!m.bag || !!m.rating, { message: 'Write a message', path: ['body'] });
export type SendSupportMessageRequest = z.input<typeof SendSupportMessageRequest>;
export const SendSupportMessageResponse = z.object({ messages: z.array(SupportMessage) });
export const SupportUnreadResponse = z.object({ unread: z.number().int().nonnegative() });

/** The desk: one number, day and night. */
export const DESK_PHONE = '+966 11 520 0000';
export const DESK_TEL = 'tel:+966115200000';
export const DESK_SMS = 'sms:+966115200000';
export const DESK_WHATSAPP = 'https://wa.me/966115200000';

export const PhoneChange = z.object({ phone: PhoneE164 });
