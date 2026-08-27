import React, { useEffect, useRef, useState } from "react";
import { dashboardDirection, type DashboardLocale } from "@/lib/dashboardI18n";
import { dashboardIntroCopy } from "@/lib/dashboardIntroI18n";
import { KRONOS_BOT_NAME, KRONOS_CREATOR_HANDLE } from "@/lib/kronosBrand";

type KronosIntroProps = { locale: DashboardLocale; onComplete: () => void };

/** A cinematic Persian Future intro using only transform and opacity animation; intentionally silent. */
export function KronosIntro({ locale, onComplete }: KronosIntroProps) {
  const [leaving, setLeaving] = useState(false);
  const copy = dashboardIntroCopy[locale];
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const leaveTimer = window.setTimeout(() => setLeaving(true), reducedMotion ? 180 : 3900);
    const completeTimer = window.setTimeout(() => onCompleteRef.current(), reducedMotion ? 240 : 4320);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(completeTimer);
    };
  }, []);

  return <section dir={dashboardDirection(locale)} lang={locale} aria-label={KRONOS_BOT_NAME} className={`kronos-intro ${leaving ? "kronos-intro--leaving" : ""}`}>
    <div className="kronos-intro__grid" aria-hidden="true" />
    <div className="kronos-intro__horizon" aria-hidden="true" />
    <div className="kronos-intro__content">
      <div className="kronos-intro__stage" aria-hidden="true">
        <div className="kronos-intro__aura" />
        <div className="kronos-intro__orbit kronos-intro__orbit--outer"><i /><i /><i /></div>
        <div className="kronos-intro__orbit kronos-intro__orbit--inner"><i /><i /></div>
        <div className="kronos-intro__crest">
          <div className="kronos-intro__shield"><span>K</span></div>
          <b>KG</b>
        </div>
        <div className="kronos-intro__spark kronos-intro__spark--one" />
        <div className="kronos-intro__spark kronos-intro__spark--two" />
      </div>
      <div className="kronos-intro__eyebrow" dir="ltr">PERSIAN FUTURE / KG-01</div>
      <div dir="ltr" lang="en" className="kronos-intro__wordmark" aria-label="Kronos Guard"><strong>Kronos</strong><span>Guard</span></div>
      <p className="kronos-intro__status" role="status" aria-live="polite"><i />{copy.loading}</p>
      <p className="kronos-intro__creator">{copy.creator} <strong>{KRONOS_CREATOR_HANDLE}</strong></p>
    </div>
  </section>;
}
