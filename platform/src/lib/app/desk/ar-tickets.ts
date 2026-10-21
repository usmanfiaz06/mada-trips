// Arabic for desk tickets (lib/app/desk/tickets.ts and the Tickets pages). The English string is the key; merged into
// src/lib/i18n/ar.ts.
export const AR_DESK_TICKETS: Record<string, string> = {
  // lists and the queue
  "Tickets": "التذاكر", "New ticket": "تذكرة جديدة", "Create ticket": "إنشاء تذكرة", "Due soon": "يستحق قريبًا", "Past its promise": "تجاوزت الموعد",
  "Every ticket on the desk, opened by the queue or by hand. The clock stops while a ticket waits on the customer or a supplier.": "كل تذاكر المكتب، سواء فتحتها قائمة العمل أو فُتحت يدويًا. يتوقف العدّاد ما دامت التذكرة بانتظار العميل أو المورّد.",
  "Resolved": "محلولة", "All": "الكل",   "Waiting on customer": "بانتظار العميل", "Waiting on supplier": "بانتظار المورّد",
  "Urgent": "عاجلة", "High": "عالية", "Normal": "عادية", "Low": "منخفضة",
  "T-000123, subject, traveller, category…": "T-000123، الموضوع، المسافر، الفئة…", "Priority": "الأولوية", "Any priority": "أي أولوية", "Owner": "المسؤول", "Anyone's": "الجميع",
  "Mine": "لي", "{n} tickets": "{n} تذكرة", "No tickets match": "لا تذاكر مطابقة", "No tickets here": "لا تذاكر هنا",
  "Tickets open by themselves when travellers need the desk, or from “Create ticket” on any order, request or chat.": "تُفتح التذاكر تلقائيًا حين يحتاج المسافرون إلى المكتب، أو من «إنشاء تذكرة» في أي طلب أو محادثة.",
  "Traveller": "المسافر", "Status": "الحالة", "Last activity": "آخر نشاط", "Clock paused": "العدّاد متوقف",
  // new ticket
  "For anything the team must follow up. It's yours once it's open, and due by its priority: urgent in 30 minutes, high in 4 hours, normal in a day, low in 3 days.": "لأي أمر يجب على الفريق متابعته. تصبح لك فور فتحها، وموعدها حسب أولويتها: العاجلة خلال 30 دقيقة، والعالية خلال 4 ساعات، والعادية خلال يوم، والمنخفضة خلال 3 أيام.",
  "What it's about": "موضوعها", "Subject": "الموضوع", "Category": "الفئة", "Change, complaint, visa…": "تعديل، شكوى، تأشيرة…",
  "Their phone or email, if it's about someone": "جواله أو بريده، إن كانت تخص مسافرًا", "Note for the team": "ملاحظة للفريق",   "{n} open": "{n} مفتوحة", "No open ticket": "لا تذكرة مفتوحة",
  // the ticket page
  "First reply {when}": "أول رد {when}", "Clock paused {when}": "توقف العدّاد {when}", "Merged": "دُمجت", "Reopened {n}×": "أُعيد فتحها {n}×",
  "Conversation": "المحادثة", "The order's or request's thread with the traveller": "محادثة الطلب مع المسافر", "The traveller's support chat": "محادثة الدعم مع المسافر",
  "Your first reply opens a support chat with the traveller": "يفتح ردك الأول محادثة دعم مع المسافر", "Notes for the team only: this ticket has no traveller": "ملاحظات للفريق فقط: لا مسافر لهذه التذكرة",
  "Open in Chats": "افتحها في المحادثات", "No messages yet. Notes you add show here for the team.": "لا رسائل بعد. تظهر هنا الملاحظات التي تضيفها للفريق.",
  "Linked records": "السجلات المرتبطة", "{n} linked": "{n} مرتبط", "Nothing linked yet.": "لا شيء مرتبط بعد.", "Type": "النوع", "Record": "السجل", "Linked": "رُبط",
  "Request": "طلب", "Chat": "محادثة", "Refund": "استرداد", "eSIM": "شريحة إلكترونية", "Moderation": "الإشراف",
  "Account recovery": "استعادة الحساب", "Ask thread": "محادثة اسأل مادا", "Customer": "العميل", "Merged ticket": "تذكرة مدموجة",
  "Ticket history": "سجل التذكرة", "Mada desk": "مكتب مادا", "Opened": "فُتحت", "Reopened": "أُعيد فتحها",
  "Gave it to {name}": "أُسندت إلى {name}", "Priority: {from} → {to}": "الأولوية: {from} ← {to}",
  "Category: {to}": "الفئة: {to}", "Tags: {to}": "الوسوم: {to}", "Added a note": "أضاف ملاحظة", "First reply to the traveller": "أول رد على المسافر",
  "Replied to the traveller": "ردّ على المسافر", "Cleared the escalation": "ألغى التصعيد",   "Next": "التالي", "Merged into {ref}": "دُمجت في {ref}", "Closed for good. A new message opens a new ticket.": "أُغلقت نهائيًا. أي رسالة جديدة تفتح تذكرة جديدة.",
  "Resolved. It reopens if the traveller writes again or its source needs the desk.": "حُلّت. يُعاد فتحها إذا كتب المسافر مجددًا أو احتاج مصدرها إلى المكتب.",
  "The clock is paused while we wait. Resume it when they answer.": "العدّاد متوقف أثناء الانتظار. شغّله مجددًا حين يأتي الرد.", "Work it, reply, then resolve.": "تابعها، ثم ردّ، ثم احلّها.",
  "Twice past its promise: the partners are told": "تجاوزت موعدها بضعفه: أُبلغ الشركاء", "Past its promise: the lead is told": "تجاوزت موعدها: أُبلغ المشرف",
  "Open it": "افتحه", "Wait on customer": "بانتظار العميل", "Wait on supplier": "بانتظار المورّد", "Supplier answered": "ردّ المورّد",
  "Customer answered": "ردّ العميل", "Resolve": "حلّ", "Reopen": "إعادة فتح", "Close now": "أغلقها الآن", "Properties": "الخصائص", "First reply": "أول رد",
  "{n} min": "{n} د", "Paused": "متوقف", "Value": "القيمة", "Rating": "التقييم",   "Only a lead can move someone else's ticket": "لا ينقل تذكرة زميل إلا المشرف", "Tags, comma separated": "وسوم، تفصلها فواصل", "Tags": "الوسوم", "Save": "حفظ",
  "You": "أنت", "Covering tonight": "يغطي الليلة",   "Merge": "دمج",
  "Same problem twice? Merge this ticket into the other: its links and notes move there, and this one closes.": "المشكلة نفسها مرتين؟ ادمج هذه التذكرة في الأخرى: تنتقل روابطها وملاحظاتها إليها وتُغلق هذه.",
  "Ticket to merge into": "التذكرة المدموج فيها", "Merge {ref} into the other ticket? This one closes.": "دمج {ref} في التذكرة الأخرى؟ ستُغلق هذه.", "Merged in: {refs}": "دُمج فيها: {refs}",
  // what the desk did by itself
  "Finished where it was worked": "اكتملت حيث عولجت", "Answered in the chat": "رُدّ عليها في المحادثة", "Waiting on the traveller": "بانتظار المسافر", "Quiet for 72 hours": "لا نشاط منذ 72 ساعة",
  "Opened from this order": "فُتحت من هذا الطلب", "Opened from this request": "فُتحت من هذا الطلب", "Opened from this chat": "فُتحت من هذه المحادثة", "Opened from this customer": "فُتحت من صفحة هذا العميل",
  "Opened from this refund": "فُتحت من هذا الاسترداد", "Opened from this esim": "فُتحت من هذه الشريحة", "Opened from this ask thread": "فُتحت من محادثة اسأل مادا هذه",
  // what actions say back
  "It's yours": "أصبحت لك", "Reassigned": "أُعيد الإسناد", "Note added": "أُضيفت الملاحظة", "Sent": "أُرسل",
  "Waiting on the customer. The clock is paused": "بانتظار العميل. توقف العدّاد", "Waiting on the supplier. The clock is paused": "بانتظار المورّد. توقف العدّاد",
  "Back with us. The clock runs again": "عادت إلينا. عاد العدّاد للعمل",
  "Say what the ticket is about": "اكتب موضوع التذكرة", "Keep the subject under 200 characters": "اجعل الموضوع أقل من 200 حرف", "This ticket is closed": "هذه التذكرة مغلقة",
  "Set up your desk profile first (Team & rota)": "أنشئ ملفك في المكتب أولًا (الفريق والمناوبات)", "Choose a priority": "اختر الأولوية",
  "That can't be done to this ticket now": "لا يمكن تنفيذ ذلك على هذه التذكرة الآن", "The traveller is still waiting: reply first, then resolve": "ما زال المسافر ينتظر: ردّ أولًا ثم احلّها",
  "This still needs the desk: finish it on its own page and the ticket resolves itself": "ما زالت تحتاج إلى المكتب: أنجزها في صفحتها وستُحل التذكرة تلقائيًا",
  "Write the note first": "اكتب الملاحظة أولًا", "Keep notes under 2,000 characters": "اجعل الملاحظات أقل من 2,000 حرف",
  "This ticket has no traveller to write to: add a note instead": "لا مسافر لهذه التذكرة لمراسلته: أضف ملاحظة بدلًا من ذلك",
  "Choose a different ticket to merge into": "اختر تذكرة أخرى للدمج", "A closed ticket can't be merged": "لا يمكن دمج تذكرة مغلقة", "Ticket not found": "التذكرة غير موجودة",
  "No traveller with that phone or email": "لا مسافر بهذا الجوال أو البريد", "Unknown item": "عنصر غير معروف",
  // the lead's bell
  "{ref} is late: {subject}": "{ref} متأخرة: {subject}", "With {name}": "مع {name}", "Nobody has it": "لم يأخذها أحد",
  // permissions
  "Reassign anyone's tickets & merge them": "إعادة إسناد تذاكر الجميع ودمجها",
};
