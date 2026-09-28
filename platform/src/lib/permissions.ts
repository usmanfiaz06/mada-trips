// Every capability in the platform. Roles are just named bundles of these.
export const PERMISSIONS = {
  "sales.create":        { group: "sales",     en: "Create sales & bookings",            ar: "إنشاء المبيعات والحجوزات" },
  "sales.view_all":      { group: "sales",     en: "See all teams' sales",               ar: "عرض مبيعات جميع الفرق" },
  "sales.edit":          { group: "sales",     en: "Edit, void and refund sales",        ar: "تعديل وإلغاء واسترداد المبيعات" },
  "issue.unlimited":     { group: "issuance",  en: "Issue tickets without limits (TTP)", ar: "إصدار التذاكر دون حدود" },
  "issue.delegate":      { group: "issuance",  en: "Grant & revoke issuing rights",      ar: "منح وسحب صلاحية الإصدار" },
  "clients.manage":      { group: "clients",   en: "Add & edit clients",                 ar: "إضافة وتعديل العملاء" },
  "clients.credit":      { group: "clients",   en: "Set contract credit limits",         ar: "تحديد حدود ائتمان العقود" },
  "approvals.decide":    { group: "approvals", en: "Vote on approvals (directors)",      ar: "التصويت على الموافقات (أعضاء المجلس)" },
  "expenses.create":     { group: "expenses",  en: "Submit expenses",                    ar: "تقديم المصروفات" },
  "expenses.view_all":   { group: "expenses",  en: "See all expenses",                   ar: "عرض جميع المصروفات" },
  "expenses.verify":     { group: "expenses",  en: "Verify & approve expenses",          ar: "التحقق من المصروفات واعتمادها" },
  "close.submit":        { group: "control",   en: "Submit the 10 PM daily close",       ar: "تقديم الإقفال اليومي" },
  "close.verify":        { group: "control",   en: "Verify daily closes",                ar: "التحقق من الإقفال اليومي" },
  "finance.view":        { group: "finance",   en: "See banks, cash & profit",           ar: "عرض البنوك والنقد والأرباح" },
  "finance.reconcile":   { group: "finance",   en: "Clear receipts & manage BSP",        ar: "مطابقة المقبوضات وإدارة BSP" },
  "settlement.run":      { group: "finance",   en: "Prepare the Day-25 settlement",      ar: "إعداد تسوية اليوم ٢٥" },
  "ledger.view_all":     { group: "partners",  en: "See all partner ledgers",            ar: "عرض دفاتر جميع الشركاء" },
  "ledger.manage":       { group: "partners",  en: "Record partner advances",            ar: "تسجيل سلف الشركاء" },
  "team.manage":         { group: "admin",     en: "Add & manage team members",          ar: "إدارة أعضاء الفريق" },
  "roles.manage":        { group: "admin",     en: "Create & edit roles",                ar: "إنشاء وتعديل الأدوار" },
  "activity.view":       { group: "admin",     en: "See the full activity log",          ar: "عرض سجل النشاط الكامل" },
  "settings.manage":     { group: "admin",     en: "Change limits & rules",              ar: "تعديل الحدود والقواعد" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS = {
  sales: { en: "Sales", ar: "المبيعات" },
  issuance: { en: "Issuance", ar: "الإصدار" },
  clients: { en: "Clients & credit", ar: "العملاء والائتمان" },
  approvals: { en: "Approvals", ar: "الموافقات" },
  expenses: { en: "Expenses", ar: "المصروفات" },
  control: { en: "Daily control", ar: "الرقابة اليومية" },
  finance: { en: "Finance", ar: "المالية" },
  partners: { en: "Partners", ar: "الشركاء" },
  admin: { en: "Administration", ar: "الإدارة" },
} as const;

export const SYSTEM_ROLES: { key: string; name: string; nameAr: string; description: string; permissions: Permission[] }[] = [
  { key: "chairman", name: "Chairman · Finance", nameAr: "رئيس مجلس الإدارة · المالية", description: "Receives daily reports, verifies expenses, runs reconciliation and the Day-25 close.", permissions: ALL_PERMISSIONS.filter((p) => p !== "issue.unlimited" && p !== "issue.delegate") },
  { key: "ceo", name: "CEO · Issuing authority", nameAr: "الرئيس التنفيذي · صلاحية الإصدار", description: "Holds ticketing authority (TTP) and delegates it. Full operational access.", permissions: ALL_PERMISSIONS },
  { key: "director", name: "Director", nameAr: "عضو مجلس الإدارة", description: "Votes on approvals, sees all numbers and the partner ledger.", permissions: ["sales.view_all", "approvals.decide", "expenses.create", "expenses.view_all", "expenses.verify", "finance.view", "ledger.view_all", "activity.view", "close.verify"] },
  { key: "retail_agent", name: "Retail agent (Riyadh)", nameAr: "موظف مبيعات التجزئة (الرياض)", description: "Serves walk-in and online customers, takes payment, submits the 10 PM close.", permissions: ["sales.create", "clients.manage", "expenses.create", "close.submit"] },
  { key: "corporate_agent", name: "Corporate desk (Pakistan)", nameAr: "فريق الشركات (باكستان)", description: "Prepares corporate bookings and invoices. Cannot issue tickets.", permissions: ["sales.create", "clients.manage", "close.submit"] },
];
