import { useState, type ReactNode } from 'react';

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible titled group used throughout the left control panel. */
export function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="section">
      <button type="button" className="section-header" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="section-chevron">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
