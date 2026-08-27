import React, { useEffect, type ReactNode } from "react";

type MobileMenuLayerProps = {
  open: boolean;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

export function MobileMenuLayer({ open, closeLabel, onClose, children }: MobileMenuLayerProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  return (
    <>
      <aside
        className={`kronos-sidebar overflow-hidden ${open ? "kronos-sidebar--open" : "kronos-sidebar--closed"}`}
        data-menu-open={open ? "true" : "false"}
        aria-hidden={!open}
      >
        {children}
      </aside>
      {open && (
        <button
          type="button"
          aria-label={closeLabel}
          className="kronos-menu-backdrop fixed inset-0 z-30 bg-slate-950/70 lg:hidden"
          onClick={onClose}
        />
      )}
    </>
  );
}
