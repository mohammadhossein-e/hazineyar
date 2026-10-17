import { MAX_DESCRIPTION_LENGTH } from "@/core/expenses/schemas";

export const MESSAGES = {
  start:
    "به ربات ثبت هزینه خوش آمدید 👷\n\n" +
    "برای ثبت هزینه جدید دستور /expense را بزنید.\n" +
    "اگر در هر مرحله خواستید کنار بگذارید، /cancel را بزنید.",

  help:
    "دستورهای ربات:\n" +
    "/start — معرفی ربات\n" +
    "/expense — ثبت هزینه جدید\n" +
    "/cancel — لغو ثبت هزینه فعلی",

  notRegistered:
    "⛔️ شما در سامانه ثبت نشده‌اید.\n" +
    "برای فعال‌سازی دسترسی، لطفاً به مدیر سیستم اطلاع دهید.",

  accessRequested:
    "✅ درخواست دسترسی شما ثبت شد.\n" +
    "پس از تایید مدیر، می‌توانید با دستور /expense هزینه ثبت کنید.",

  accessRejected:
    "⛔️ دسترسی شما تایید نشده است.\n" +
    "برای اطلاعات بیشتر با مدیر سیستم تماس بگیرید.",

  accessBusy:
    "⏳ در حال حاضر امکان ثبت درخواست جدید وجود ندارد.\n" +
    "لطفاً کمی بعد دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.",

  groupNotLinked:
    "این گروه به ربات متصل نیست.\n" +
    "برای اتصال، یک ادمین باید داخل گروه دستور /linkgroup را بزند.",

  groupAskPrivate:
    "برای ثبت هزینه، دکمه زیر را بزنید و در چت خصوصی ادامه دهید:",

  groupRegisterFirst:
    "ابتدا در چت خصوصی ربات /start بزنید:",

  linkGroupOnlyInGroup: "این دستور فقط داخل گروه کار می‌کند.",

  linkGroupNotAllowed:
    "⛔️ فقط ادمین‌های ثبت‌شده می‌توانند گروه را به ربات متصل یا قطع کنند.",

  linkGroupDone:
    "✅ این گروه به ربات متصل شد.\n" +
    "اعضا می‌توانند با دستور /expense هزینه ثبت کنند.",

  unlinkGroupDone: "✅ اتصال این گروه از ربات برداشته شد.",

  linkGroupNotLinked: "این گروه هنوز به ربات متصل نشده است.",

  groupAnnounceFailed:
    "⚠️ هزینه ثبت شد، اما اعلام آن در گروه ناموفق بود.\n" +
    "مدیر سیستم می‌تواند آن را در گزارش‌ها ببیند.",

  privateButton: "ثبت در چت خصوصی",

  privateStartButton: "شروع چت خصوصی",

  noAccess:
    "⛔️ شما دسترسی ثبت هزینه ندارید.\n" +
    "حساب شما غیرفعال شده است؛ برای فعال‌سازی دوباره با مدیر سیستم تماس بگیرید.",

  noProjects:
    "⛔️ برای شما هیچ پروژه فعالی تعریف نشده است.\n" +
    "لطفاً به مدیر سیستم اطلاع دهید.",

  cancelled: "❌ ثبت هزینه لغو شد.",

  pickProject: "پروژه‌ای را که هزینه برای آن است ثبت می‌کنید انتخاب کنید:",

  pickProjectAgain: "لطفاً یکی از دکمه‌های پروژه را بزنید.",

  pickCategory: "دسته‌بندی هزینه را انتخاب کنید:",

  pickCategoryAgain: "لطفاً یکی از دکمه‌های دسته‌بندی را بزنید.",

  enterAmount: "مبلغ هزینه را به تومان وارد کنید (عدد صحیح، مثلاً 1250000):",

  invalidAmount:
    "❌ مبلغ نامعتبر است.\n" +
    "یک عدد صحیح و بزرگ‌تر از صفر به تومان وارد کنید.\n" +
    "ارقام فارسی هم پذیرفته می‌شود. مثال: ۱٬۲۵۰٬۰۰۰",

  askDescription:
    "توضیحات (اختیاری): می‌خواهید توضیحی برای این هزینه بنویسید؟\n" +
    "می‌توانید متن دلخواه را بنویسید یا دکمه «رد کردن» را بزنید.",

  descriptionAgain:
    "لطفاً توضیحات را به متن بنویسید یا دکمه «رد کردن» را بزنید.",

  descriptionTooLong:
    `❌ توضیحات خیلی طولانی است.\nحداکثر ${MAX_DESCRIPTION_LENGTH} کاراکتر مجاز است.`,

  askInvoice:
    "عکس یا فایل فاکتور را بفرستید.\n" +
    "اگر فاکتوری ندارید یا نمی‌خواهید ارسال کنید، دکمه «بدون فاکتور» را بزنید.",

  askInvoiceAgain:
    "لطفاً عکس یا فایل فاکتور را ارسال کنید یا دکمه «بدون فاکتور» را بزنید.",

  downloadFailed: "❌ دریافت تصویر فاکتور ناموفق بود. لطفاً دوباره تلاش کنید.",

  saveFailed:
    "❌ هزینه ثبت شد، اما ذخیره فاکتور ناموفق بود.\n" +
    "مدیر سیستم می‌تواند فایل را بعداً پیوست کند.",

  attachFailed:
    "❌ هزینه ثبت شد، اما پیوست فاکتور ناموفق بود.\n" +
    "مدیر سیستم می‌تواند فایل را بعداً پیوست کند.",

  retry: "🔄 تلاش مجدد",

  cancel: "لغو",

  skipDescription: "رد کردن",

  skipInvoice: "بدون فاکتور",

  confirm: "تأیید",

  editExpense: "ویرایش",

  cancelExpense: "لغو",

  confirmPrompt: "لطفاً اطلاعات هزینه را بررسی کنید:",

  pickEditField: "کدام مورد را می‌خواهید ویرایش کنید؟",

  editProject: "پروژه",

  editCategory: "دسته‌بندی",

  editAmount: "مبلغ",

  editDescription: "توضیحات",

  confirmAgain: "لطفاً یکی از دکمه‌های تأیید، ویرایش یا لغو را بزنید.",

  pickEditFieldAgain: "لطفاً یکی از موارد قابل ویرایش را انتخاب کنید.",

  genericError:
    "❌ خطایی رخ داد و هزینه ثبت نشد.\n" +
    "لطفاً دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.",

  unexpected: "متوجه نشدم. برای ثبت هزینه /expense را بزنید.",

  /**
   * One-line entry: the text carried a number that is not a usable amount.
   * Covers zero, negatives, decimals and absurdly large values in one reply.
   */
  quickAmountInvalid:
    "❌ مبلغ نامعتبر است.\n" +
    "یک عدد صحیح و بزرگ‌تر از صفر به تومان بنویسید. مثال: سعادت‌آباد مصالح ۱٬۲۵۰٬۰۰۰",

  /** Offered when a line had a project/category but no amount. */
  quickContinue: "ادامه با دکمه‌ها",

  /** Header above the fields the bot recognised in a one-line entry. */
  quickUnderstood: "این موارد را از پیام شما متوجه شدم:",

  quickNowComplete: "همه‌چیز مشخص است؛ لطفاً تأیید کنید:",

  /** Shown beside the project step when a previous choice is remembered. */
  lastChoiceButton: "همان پروژه و دسته قبلی",
} as const;

/** The remembered choice line appended to the project prompt. */
export function lastChoiceHint(projectName: string, category: string): string {
  return `آخرین: ${projectName} · ${category}`;
}

/** The one-tap shortcut button, naming exactly what it will reuse. */
export function lastChoiceShortcut(projectName: string, category: string): string {
  return `${MESSAGES.lastChoiceButton} (${projectName} · ${category})`;
}

/** A summary of the fields a one-line entry resolved, for the reply. */
export function quickUnderstoodLines(input: {
  amount?: string | null;
  projectName?: string | null;
  category?: string | null;
  description?: string | null;
}): string {
  const lines: string[] = [MESSAGES.quickUnderstood];
  if (input.amount) lines.push(`مبلغ: ${input.amount} تومان`);
  if (input.projectName) lines.push(`پروژه: ${input.projectName}`);
  if (input.category) lines.push(`دسته‌بندی: ${input.category}`);
  if (input.description) lines.push(`توضیحات: ${input.description}`);
  return lines.join("\n");
}

export function savedConfirmation(input: {
  projectName: string;
  category: string;
  amount: string;
  invoiceNumber: string;
  hasInvoice: boolean;
  description?: string | null;
}): string {
  return [
    "✅ هزینه با موفقیت ثبت شد.",
    "",
    `پروژه: ${input.projectName}`,
    `دسته‌بندی: ${input.category}`,
    `مبلغ: ${input.amount} تومان`,
    // Omitted rather than shown as "ندارد", so the message stays short for
    // the common case where there is no note.
    ...(input.description ? [`توضیحات: ${input.description}`] : []),
    `شماره فاکتور: ${input.invoiceNumber}`,
    `فاکتور: ${input.hasInvoice ? "پیوست شد" : "ندارد"}`,
  ].join("\n");
}

export function failedWithRetry(reason: string): string {
  return `${reason}\n\nمی‌توانید دوباره تلاش کنید.`;
}

/**
 * The pre-save summary. Nothing is written until the user approves this, so the
 * invoice is shown as present/absent here rather than as a stored file.
 */
export function expenseSummaryForConfirm(input: {
  projectName: string;
  category: string;
  amount: string;
  description?: string | null;
  hasInvoice: boolean;
}): string {
  return [
    MESSAGES.confirmPrompt,
    "",
    `پروژه: ${input.projectName}`,
    `دسته‌بندی: ${input.category}`,
    `مبلغ: ${input.amount} تومان`,
    ...(input.description ? [`توضیحات: ${input.description}`] : []),
    `فاکتور: ${input.hasInvoice ? "دارد" : "ندارد"}`,
  ].join("\n");
}

export function selfCancelButton(): string {
  return "لغو این هزینه";
}

export function selfCancelSuccess(invoiceNumber: string): string {
  return `❌ هزینه ${invoiceNumber} لغو شد.`;
}

export function selfCancelWindowClosed(): string {
  return "⏱ مهلت لغو این هزینه گذشته است. برای اصلاح آن با مدیر سیستم تماس بگیرید.";
}

/** Announce that an already-recorded expense was changed, in the same group. */
export function correctionNotice(input: {
  action: "edit" | "delete" | "cancel" | "restore";
  userName: string;
  projectName: string;
  amount?: string | null;
  category?: string | null;
  reason?: string | null;
}): string {
  const who = `${input.userName} | ${input.projectName}`;
  const head =
    input.action === "edit"
      ? `✏️ هزینه ثبت‌شده اصلاح شد: ${who}`
      : input.action === "delete"
        ? `🗑 هزینه ثبت‌شده حذف شد: ${who}`
        : input.action === "cancel"
          ? `↩️ هزینه لغو شد: ${who}`
          : `♻️ هزینه بازگردانی شد: ${who}`;

  const segments: string[] = [];
  if (input.category) segments.push(input.category);
  if (input.amount) segments.push(`${input.amount} تومان`);
  if (input.reason) segments.push(`دلیل: ${input.reason}`);

  return segments.length > 0 ? `${head}\n${segments.join(" | ")}` : head;
}
