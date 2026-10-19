'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
let openModals = 0;
let previousOverflow = '';

export function Modal({ title, children, onClose, className = '' }: {title: string; children: ReactNode; onClose?: () => void; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const outsideDialog = (x: number, y: number) => {
    const bounds = ref.current?.getBoundingClientRect();
    return !!bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);
  };
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    if (openModals === 0) previousOverflow = document.body.style.overflow;
    openModals += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} onCancel={event => {event.preventDefault(); onClose?.();}} onPointerDown={event => {backdropPress.current = event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY);}} onClick={event => {if(event.target === event.currentTarget && backdropPress.current && outsideDialog(event.clientX, event.clientY)) onClose?.();}} aria-label={title}><div className="modal-heading"><span className="eyebrow">잔상</span>{onClose && <button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20}/></button>}</div><h2>{title}</h2>{children}</dialog>;
}
