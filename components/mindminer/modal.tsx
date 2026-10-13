'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, children, onClose, className = '' }: {title: string; children: ReactNode; onClose: () => void; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {dialog?.close(); document.body.style.overflow = old;};
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if(event.target === event.currentTarget) onClose();}} aria-label={title}><div className="modal-heading"><span className="eyebrow">MindMiner</span><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20}/></button></div><h2>{title}</h2>{children}</dialog>;
}
