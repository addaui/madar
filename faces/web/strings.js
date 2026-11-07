// More words for the web board. English and Arabic (the Arabic is a first draft, not yet reviewed by a speaker).
Object.assign(STR.en, {
  home: "Home", notes: "Notes", newNote: "New note", newPage: "New page", untitled: "Untitled", pages: "Pages", board: "Board", list: "List", overview: "Overview",
  settings: "Settings", projectSettings: "Project settings", focusMode: "Focus mode", exitFocus: "Exit focus mode", toggleSide: "Show or hide the sidebar",
  startHere: "Start here", alsoOpen: "Also open", assignedAll: "Everything assigned to me", nothingOpen: "Nothing open. Enjoy the quiet.",
  g_appearance: "Appearance", g_account: "Account", g_behaviour: "Behaviour", g_other: "Other", theme: "Theme", yes: "Yes", no: "No",
  columns: "Columns", addColumn: "Add a column", columnName: "Column name", doneNote: "The last column means done.", up: "Move up", down: "Move down",
  attributes: "Custom fields", addAttribute: "Add a field", fieldKey: "Key", fieldLabel: "Label", fieldType: "Type", fieldChoices: "Choices (comma separated)",
  t_text: "Text", t_number: "Number", t_date: "Date", t_boolean: "Yes / no", t_choice: "Choice", all: "All", search: "Search…", sortBy: "Sort by", total: "Total",
  openN: "Open", doneN: "Done", overdueN: "Overdue", byColumn: "By column", byPriority: "By priority", completions: "Completed per day",
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent", timeline: "Timeline", loadOlder: "Load older", reply: "Reply", replies: "replies", oneReply: "1 reply", hideThread: "Hide thread",
  saving: "Saving…", saved: "Saved", linkedFrom: "Linked from", noLinks: "Nothing links here yet.", addChild: "Add a page inside", pageChanged: "This page changed elsewhere. It was reloaded.",
  description: "Description", pickItem: "Link to a page or task", searchItems: "Search pages and tasks…", ok: "OK", workspaces: "Workspaces", newWorkspace: "New workspace", moveTo: "Move to",
  defaultWs: "Default", renameWs: "Rename workspace", deleteWs: "Delete workspace", updateKind: "Update", comment: "Comment", pin: "Update", history: "History",
  who_you: "you", wsNotEmpty: "Move its projects elsewhere first.", imageAddr: "Image address", noPages: "No pages yet.", writeHere: "Write something, or type / for blocks…",
  custom: "Custom fields", body: "Content", icon: "Icon", sureColumn: "Remove this column? Tasks in it must be moved first.",
});
Object.assign(STR.ar, {
  home: "الرئيسية", notes: "ملاحظات", newNote: "ملاحظة جديدة", newPage: "صفحة جديدة", untitled: "بلا عنوان", pages: "الصفحات", board: "اللوحة", list: "القائمة", overview: "نظرة عامة",
  settings: "الإعدادات", projectSettings: "إعدادات المشروع", focusMode: "وضع التركيز", exitFocus: "الخروج من وضع التركيز", toggleSide: "إظهار الشريط الجانبي أو إخفاؤه",
  startHere: "ابدأ من هنا", alsoOpen: "مفتوحة أيضاً", assignedAll: "كل ما أُسند إليّ", nothingOpen: "لا شيء مفتوح. استمتع بالهدوء.",
  g_appearance: "المظهر", g_account: "الحساب", g_behaviour: "السلوك", g_other: "أخرى", theme: "السمة", yes: "نعم", no: "لا",
  columns: "الأعمدة", addColumn: "أضف عموداً", columnName: "اسم العمود", doneNote: "العمود الأخير يعني الإنجاز.", up: "أعلى", down: "أسفل",
  attributes: "حقول مخصصة", addAttribute: "أضف حقلاً", fieldKey: "المفتاح", fieldLabel: "التسمية", fieldType: "النوع", fieldChoices: "الخيارات (مفصولة بفواصل)",
  t_text: "نص", t_number: "رقم", t_date: "تاريخ", t_boolean: "نعم / لا", t_choice: "اختيار", all: "الكل", search: "بحث…", sortBy: "رتّب حسب", total: "المجموع",
  openN: "مفتوحة", doneN: "منجزة", overdueN: "متأخرة", byColumn: "حسب العمود", byPriority: "حسب الأولوية", completions: "المنجز يومياً",
  low: "منخفضة", medium: "متوسطة", high: "عالية", urgent: "عاجلة", timeline: "الخط الزمني", loadOlder: "تحميل الأقدم", reply: "رد", replies: "ردود", oneReply: "رد واحد", hideThread: "إخفاء النقاش",
  saving: "جارٍ الحفظ…", saved: "تم الحفظ", linkedFrom: "مرتبطة من", noLinks: "لا شيء يرتبط بهذا بعد.", addChild: "أضف صفحة بداخلها", pageChanged: "تغيّرت هذه الصفحة في مكان آخر. أُعيد تحميلها.",
  description: "الوصف", pickItem: "رابط إلى صفحة أو مهمة", searchItems: "ابحث في الصفحات والمهام…", ok: "حسناً", workspaces: "مساحات العمل", newWorkspace: "مساحة عمل جديدة", moveTo: "انقل إلى",
  defaultWs: "الافتراضية", renameWs: "إعادة تسمية مساحة العمل", deleteWs: "حذف مساحة العمل", updateKind: "تحديث", comment: "تعليق", pin: "تحديث", history: "السجل",
  who_you: "أنت", wsNotEmpty: "انقل مشاريعها أولاً.", imageAddr: "عنوان الصورة", noPages: "لا صفحات بعد.", writeHere: "اكتب شيئاً، أو اضغط / للكتل…",
  custom: "الحقول المخصصة", body: "المحتوى", icon: "الأيقونة", sureColumn: "إزالة هذا العمود؟ يجب نقل المهام التي فيه أولاً.",
});

Object.assign(STR.en, {
  noResults: "Nothing found.", pageHistory: "History", restoreVersion: "Restore this version", sureRestore: "Put this version back? The current page is kept in the history.", restored: "Version restored",
  noVersions: "No earlier versions yet. They appear once you edit.", repeat: "Repeat", noRepeat: "Does not repeat", every: "Every", days: "days", weeks: "weeks", months: "months",
  every1_day: "Every day", every1_week: "Every week", every1_month: "Every month", uploadImage: "Upload an image", uploading: "Uploading…", fileTooBig: "That file is larger than 4 MB.",
  hPages_created: "{actor} added the page {task}", hPages_updated: "{actor} edited the page {task}", hPages_moved: "{actor} moved the page {task}", hPages_removed: "{actor} deleted the page {task}",
  hTasks_recurred: "{task} was repeated as a new task",
});
Object.assign(STR.ar, {
  noResults: "لا نتائج.", pageHistory: "السجل", restoreVersion: "استعادة هذه النسخة", sureRestore: "هل تريد إرجاع هذه النسخة؟ ستبقى الصفحة الحالية في السجل.", restored: "تمت استعادة النسخة",
  noVersions: "لا نسخ سابقة بعد. تظهر بعد التعديل.", repeat: "التكرار", noRepeat: "لا تتكرر", every: "كل", days: "أيام", weeks: "أسابيع", months: "أشهر",
  every1_day: "كل يوم", every1_week: "كل أسبوع", every1_month: "كل شهر", uploadImage: "رفع صورة", uploading: "جارٍ الرفع…", fileTooBig: "حجم الملف أكبر من 4 ميغابايت.",
  hPages_created: "{actor} أضاف الصفحة {task}", hPages_updated: "{actor} عدّل الصفحة {task}", hPages_moved: "{actor} نقل الصفحة {task}", hPages_removed: "{actor} حذف الصفحة {task}",
  hTasks_recurred: "تكررت {task} كمهمة جديدة",
});

// The redesign (ADR 0027)
Object.assign(STR.en, {
  sureTitle: "Are you sure?", clear: "Clear", signInHint: "Sign in to continue", newTask: "New task", more: "More", open: "Open",
  kSearch: "Search everything", kNewTask: "New task in this project", kClose: "Close the pane, a menu or a window", kHelp: "Keyboard shortcuts", kMove: "to move", kOpen: "to open",
  searchHint: "Type at least two letters to search tasks, pages and notes.", gMorning: "Good morning", gAfternoon: "Good afternoon", gEvening: "Good evening",
  nothingOpenHint: "Tasks assigned to you will show up here.", nothingNewHint: "Mentions and assignments will show up here.", unread: "Unread", remove: "Remove",
  unsaved: "Unsaved changes", discard: "Discard", noPagesHint: "Pages hold what a project knows: guides, decisions, meeting notes.", notesHint: "Only you can see these.",
  collapse: "Collapse", expand: "Expand", pgUp: "Move up", pgDown: "Move down", pgIndent: "Move inside the page above", pgOutdent: "Move out one level", ascending: "Ascending", descending: "Descending",
});
Object.assign(STR.ar, {
  sureTitle: "هل أنت متأكد؟", clear: "مسح", signInHint: "سجّل الدخول للمتابعة", newTask: "مهمة جديدة", more: "المزيد", open: "فتح",
  kSearch: "ابحث في كل شيء", kNewTask: "مهمة جديدة في هذا المشروع", kClose: "إغلاق اللوحة أو القائمة أو النافذة", kHelp: "اختصارات لوحة المفاتيح", kMove: "للتنقل", kOpen: "للفتح",
  searchHint: "اكتب حرفين على الأقل للبحث في المهام والصفحات والملاحظات.", gMorning: "صباح الخير", gAfternoon: "طاب يومك", gEvening: "مساء الخير",
  nothingOpenHint: "ستظهر هنا المهام المسندة إليك.", nothingNewHint: "ستظهر هنا الإشارات والإسنادات.", unread: "غير مقروء", remove: "إزالة",
  unsaved: "تغييرات غير محفوظة", discard: "تجاهل", noPagesHint: "الصفحات تحفظ ما يعرفه المشروع: أدلة وقرارات وملاحظات اجتماعات.", notesHint: "أنت وحدك ترى هذه.",
  collapse: "طيّ", expand: "توسيع", pgUp: "نقل لأعلى", pgDown: "نقل لأسفل", pgIndent: "نقل داخل الصفحة التي فوقها", pgOutdent: "نقل مستوى للخارج", ascending: "تصاعدي", descending: "تنازلي",
});
