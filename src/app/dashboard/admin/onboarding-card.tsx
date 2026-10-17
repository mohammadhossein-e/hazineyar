"use client";

import { useState } from "react";
import styles from "../dashboard.module.css";

type Props = {
  channelId: string;
  label: string;
  /** Deep link that opens the bot's private chat. */
  link: string;
  /** Inline SVG data URL, generated on the server. */
  qr: string;
};

/**
 * One network's "get your staff in" card: the deep link, a copy button and a
 * QR code the owner can print and pin up. Copy and print are the only browser
 * APIs used; the QR itself is rendered on the server so `qrcode` never reaches
 * the client bundle.
 */
export function OnboardingCard({ channelId, label, link, qr }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure origin); the link is visible
      // above and selectable, so this is a silent no-op rather than an error.
    }
  };

  return (
    <div className={styles.qrCard} data-testid={`onboarding-${channelId}`}>
      <div className={styles.qrCardBody}>
        <h3 className={styles.qrCardTitle}>{label}</h3>
        <p className={styles.hint}>
          این لینک را برای کارمندان بفرستید تا با زدن روی آن، چت خصوصی ربات باز
          شود و درخواست دسترسی‌شان همین‌جا ثبت شود.
        </p>
        <code className={styles.qrLink}>{link}</code>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={copy}>
            {copied ? "کپی شد" : "کپی لینک"}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => window.print()}
          >
            چاپ کارت
          </button>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.qrImage}
        src={qr}
        alt={`کد QR ورود به ربات ${label}`}
        width={160}
        height={160}
      />
    </div>
  );
}
