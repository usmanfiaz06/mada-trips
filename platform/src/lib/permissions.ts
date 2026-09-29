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

// All three partners share one level of access. Ticket issuing (TTP) stays with the issuing partner, as the
// governance document requires; it can be delegated to staff from the Issuance page.
export const PARTNER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "issue.unlimited" && p !== "issue.delegate");

export const SYSTEM_ROLES: { key: string; name: string; nameAr: string; description: string; permissions: Permission[] }[] = [
  { key: "partner", name: "Partner", nameAr: "شريك", description: "Full access: team, roles, approvals, finance, settlement and settings.", permissions: PARTNER_PERMISSIONS },
  { key: "partner_issuer", name: "Partner · Issuing authority", nameAr: "شريك · صلاحية الإصدار", description: "Full partner access, plus ticket issuing (TTP) and delegating it to staff.", permissions: ALL_PERMISSIONS },
  { key: "retail_agent", name: "Retail agent (Riyadh)", nameAr: "موظف مبيعات التجزئة (الرياض)", description: "Serves walk-in and online customers, takes payment, submits the 10 PM close.", permissions: ["sales.create", "clients.manage", "expenses.create", "close.submit"] },
  { key: "corporate_agent", name: "Corporate desk (Pakistan)", nameAr: "فريق الشركات (باكستان)", description: "Prepares corporate bookings and invoices. Cannot issue tickets.", permissions: ["sales.create", "clients.manage", "close.submit"] },
];
