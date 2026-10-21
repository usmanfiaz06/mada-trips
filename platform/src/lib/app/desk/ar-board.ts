// Arabic for the desk's live board and drop-offs (DESK-PLAN.md U4). Merged into src/lib/i18n/ar.ts.
export const AR_DESK_BOARD: Record<string, string> = {
  // navigation and headers
  "Live board": "لوحة الحجوزات",
  "Drop-offs": "المتوقفون في منتصف الطريق",
  "Every booking from the app, flights to Umrah, by where it is now. Each one sits in exactly one tab; anything waiting too long is marked stuck.":
    "كل حجز من التطبيق، من الطيران إلى العمرة، حسب مرحلته الآن. كل حجز في تبويب واحد فقط، وما ينتظر أكثر من اللازم يُعلَّم بأنه عالق.",
  "People who left halfway: a search, a pay sheet, a card that didn't go through, a price held and not paid. Nudge them in the app within 48 hours; call or WhatsApp only if they gave a number on a request.":
    "من توقفوا في منتصف الطريق: بحث، أو صفحة دفع، أو بطاقة لم تنجح، أو سعر محجوز لم يُدفع. ذكّرهم داخل التطبيق خلال 48 ساعة، والاتصال أو واتساب فقط لمن ترك رقمه في طلب.",
  // board tabs, products, suppliers
  "Searching": "يبحث", "Held · not paid": "محجوز · لم يُدفع", "Paid · with the desk": "مدفوع · لدى الفريق", "Confirmed · ticketed": "مؤكد · صدرت التذاكر",
  "Travelling": "مسافر الآن", "Done": "انتهى", "Problem": "مشكلة",
  "Flights": "الطيران", "Stays": "الإقامة", "Flight + stay": "طيران وإقامة", "eSIMs": "شرائح eSIM", "Transfers": "التوصيل", "Things to do": "أنشطة",
  "Umrah": "العمرة", "Visa": "التأشيرة", "Circle share": "حصة في مجموعة", "Other requests": "طلبات أخرى",
  "Mada desk": "فريق مادا", "TBO": "TBO", "Hotelbeds": "Hotelbeds", "eSIM Access": "eSIM Access", "Airalo": "Airalo", "Test supplier": "مورّد تجريبي",
  "Searches in the last day with no order after them, and requests the desk hasn't quoted yet.": "عمليات بحث خلال آخر يوم بلا طلب بعدها، وطلبات لم يُرسل الفريق تسعيرتها بعد.",
  "A price held for them that isn't paid: a bank check, a friend's share, a quote sent.": "سعر محجوز لهم ولم يُدفع: تحقق البنك، أو حصة صديق، أو تسعيرة مرسلة.",
  "Paid or authorised and with the desk: confirm, hold, answer and issue.": "مدفوع أو مفوَّض ولدى الفريق: أكّد واحجز وأجب وأصدر.",
  "Booked and ticketed, before the trip starts.": "محجوز وصدرت تذاكره، قبل بدء الرحلة.",
  "Away now: between the first day and the last, or an eSIM in use.": "مسافرون الآن: بين أول يوم وآخره، أو شريحة eSIM قيد الاستخدام.",
  "Back home, used up, or cancelled.": "عادوا، أو انتهت الباقة، أو أُلغي الحجز.",
  "Declined, ticketing failed, a capture that didn't go through, a stuck eSIM, or a cancelled flight.": "دفع مرفوض، أو تعذّر الإصدار، أو خصم لم ينجح، أو شريحة عالقة، أو رحلة أُلغيت.",
  // board filters, columns, summary
  "Ref, PNR, traveller, phone, what they booked…": "المرجع، رقم الحجز، المسافر، الجوال، ما حجزوه…",
  "Product": "المنتج", "All products": "كل المنتجات", "Supplier": "المورّد", "All suppliers": "كل المورّدين", "Any agent": "أي موظف",
  "Stuck only": "العالقة فقط", "Stuck": "عالق", "{n} bookings": "{n} حجز", "over {n} min here": "أكثر من {n} دقيقة هنا",
  "No bookings match": "لا حجوزات مطابقة", "Nothing here right now": "لا شيء هنا الآن",
  "Booking": "الحجز", "Stage": "المرحلة", "In stage": "في المرحلة منذ", "Dates": "التواريخ", "Searched": "بحث",
  "Flight cancelled or diverted": "رحلة أُلغيت أو حُوّلت", "{n} min": "{n} د", "{n} h": "{n} س", "{n} days": "{n} يوم",
  // drop-offs
  "Searched, didn't book": "بحث ولم يحجز", "Pay sheet, not paid": "فتح صفحة الدفع ولم يدفع", "Payment didn't go through": "لم ينجح الدفع", "Held, not paid": "محجوز ولم يُدفع",
  "Saw the results": "رأى النتائج", "Opened the pay sheet": "فتح صفحة الدفع", "Card declined": "رُفضت البطاقة", "Stopped at the bank check": "توقف عند تحقق البنك",
  "Waiting for a friend to pay": "بانتظار دفع صديق", "Quote sent, not paid": "أُرسلت التسعيرة ولم تُدفع",
  "Recovered": "استُعيد", "Ignored": "تم تجاهله",
  "All open": "كل المفتوحة", "Pay sheet": "صفحة الدفع", "Payment failed": "فشل الدفع", "Recovered or ignored": "مستعاد أو متجاهَل",
  "Traveller, phone, what they looked at…": "المسافر، الجوال، ما اطّلعوا عليه…",
  "{n} drop-offs": "{n} متوقف", "No drop-offs match": "لا نتائج مطابقة", "Nobody left halfway": "لم يتوقف أحد في منتصف الطريق",
  "Someone who searches, opens the pay sheet or has a card declined and doesn't book shows up here.": "من يبحث أو يفتح صفحة الدفع أو تُرفض بطاقته ثم لا يحجز يظهر هنا.",
  "{n} tries": "{n} محاولات", "What": "ماذا", "Where they stopped": "أين توقفوا", "When": "متى", "Tries in 14 days": "المحاولات خلال 14 يومًا", "Customer": "العميل",
  "Nudged {when}": "ذُكّر {when}", "Marked {mark} by {name}": "عُلّم {mark} بواسطة {name}",
  "Nudge in the app with a saved reply": "ذكّره داخل التطبيق برد محفوظ", "Choose a saved reply": "اختر ردًا محفوظًا",
  "Goes to their Mada conversation and as a push, in their language ({lang}).": "يصل إلى محادثتهم مع مادا وكإشعار، بلغتهم ({lang}).",
  "Arabic": "العربية", "English": "الإنجليزية", "Send nudge": "أرسل التذكير",
  "Nudged {when}. One nudge per drop-off.": "ذُكّر {when}. تذكير واحد لكل حالة.", "More than {n} hours ago: too late for a nudge.": "مضى أكثر من {n} ساعة: فات وقت التذكير.",
  "Following up needs the desk act right.": "المتابعة تحتاج صلاحية العمل في المكتب.",
  "More actions": "إجراءات أخرى", "Call": "اتصال", "WhatsApp": "واتساب", "No call or WhatsApp: they haven't given a number on a request.": "لا اتصال ولا واتساب: لم يتركوا رقمًا في طلب.",
  "Create ticket": "أنشئ تذكرة", "A note for the team (optional)": "ملاحظة للفريق (اختياري)", "Mark recovered": "علّمه مستعادًا", "Ignore": "تجاهل",
  // action results and refusals
  "Sent in the app, with a push": "أُرسل داخل التطبيق مع إشعار", "Marked recovered": "عُلّم مستعادًا", "Marked ignored": "عُلّم متجاهَلًا",
  "Choose recovered or ignored": "اختر مستعاد أو متجاهَل", "This drop-off isn't open any more: they may have booked": "لم تعد هذه الحالة مفتوحة: ربما حجزوا",
  "Already nudged": "سبق تذكيره", "Already marked recovered": "سبق تعليمه مستعادًا", "Already marked ignored": "سبق تعليمه متجاهَلًا", "This drop-off is already closed": "هذه الحالة مغلقة بالفعل", "Nudges go within 48 hours of the drop-off": "يُرسل التذكير خلال 48 ساعة من التوقف",
};
