import { useEffect, useRef } from "react";

export function OwnerMotionBackdrop({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updatePointer = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100));
      const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100));
      root.style.setProperty("--owner-pointer-x", `${x}%`);
      root.style.setProperty("--owner-pointer-y", `${y}%`);
      root.style.setProperty("--owner-pointer-tx", `${Math.round(event.clientX - (bounds.left + bounds.width / 2))}px`);
      root.style.setProperty("--owner-pointer-ty", `${Math.round(event.clientY - (bounds.top + bounds.height / 2))}px`);
    };
    root.addEventListener("pointermove", updatePointer, { passive: true });
    return () => root.removeEventListener("pointermove", updatePointer);
  }, []);

  return <div ref={rootRef} className={`owner-motion-stage ${className}`}>
    <div aria-hidden="true" className="owner-motion-stage__aurora" />
    <div aria-hidden="true" className="owner-motion-stage__pointer-glow" />
    <div aria-hidden="true" className="owner-motion-stage__grid" />
    <div aria-hidden="true" className="owner-motion-stage__sentinel"><i /><i /><b>⟡</b></div>
    <span aria-hidden="true" className="owner-motion-stage__orb owner-motion-stage__orb--one" />
    <span aria-hidden="true" className="owner-motion-stage__orb owner-motion-stage__orb--two" />
    <span aria-hidden="true" className="owner-motion-stage__orb owner-motion-stage__orb--three" />
    <div className="owner-motion-stage__content">{children}</div>
  </div>;
}
