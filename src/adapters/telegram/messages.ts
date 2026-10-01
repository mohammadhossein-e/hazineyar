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

  genericError:
    "❌ خطایی رخ داد و هزینه ثبت نشد.\n" +
    "لطفاً دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.",

  unexpected: "متوجه نشدم. برای ثبت هزینه /expense را بزنید.",
} as const;

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
