import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string; showCloseButton?: boolean }

export default function Modal({ title, description, onClose, children, wide, className = '', showCloseButton = true }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (ref.current?.querySelector<HTMLElement>('input, select, textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const focusable = [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]') ?? [])].filter(el => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <div className="modal-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>{showCloseButton && <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={20} /></button>}</div>
      {children}
    </div>
  </div>;
}
