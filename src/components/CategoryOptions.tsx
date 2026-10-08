import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, EllipsisVertical, Plus, Trash2, X } from 'lucide-react';
import type { EventCategory } from '../types';
import './category-options.css';

interface Props {
  category: EventCategory;
  onColorChange: (color: string) => string | null;
  onDelete?: () => void;
  disabled?: boolean;
  compact?: boolean;
}

const COLORS = [
  { value: '#D50000', label: '빨강' },
  { value: '#E67C73', label: '연한 빨강' },
  { value: '#F4511E', label: '다홍' },
  { value: '#EF6C00', label: '진한 주황' },
  { value: '#F09300', label: '주황' },
  { value: '#F6BF26', label: '노랑' },
  { value: '#E4C441', label: '겨자' },
  { value: '#C0CA33', label: '연두' },
  { value: '#7CB342', label: '풀색' },
  { value: '#0B8043', label: '초록' },
  { value: '#009688', label: '청록' },
  { value: '#039BE5', label: '하늘' },
  { value: '#33B679', label: '민트' },
  { value: '#3F51B5', label: '남색' },
  { value: '#7986CB', label: '라벤더' },
  { value: '#B39DDB', label: '연보라' },
  { value: '#8E24AA', label: '진보라' },
  { value: '#9E69AF', label: '자주' },
  { value: '#AD1457', label: '진분홍' },
  { value: '#D81B60', label: '분홍' },
  { value: '#616161', label: '회색' },
  { value: '#A79B8E', label: '갈색' },
  { value: '#6D8EC7', label: '파랑' },
  { value: '#9B79CF', label: '보라' },
];

interface Position { left: number; top: number; maxHeight: number; width: number }

function checkColor(hex: string) {
  const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 165 ? '#302735' : '#FFFFFF';
}

export default function CategoryOptions({ category, onColorChange, onDelete, disabled = false, compact = false }: Props) {
  const panelId = useId();
  const customId = useId();
  const errorId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const palette = useRef<HTMLDivElement>(null);
  const hexInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customColor, setCustomColor] = useState(category.color.toUpperCase());
  const [error, setError] = useState('');
  const [position, setPosition] = useState<Position | null>(null);
  const selectedColor = category.color.toUpperCase();
  const customSelected = !COLORS.some(color => color.value === selectedColor);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus && trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
  }

  function toggle() {
    if (disabled) return;
    if (open) { close(true); return; }
    setError('');
    setCustomOpen(false);
    setCustomColor(selectedColor);
    setPosition(null);
    setOpen(true);
  }

  function saveColor(color: string) {
    if (disabled) return;
    const normalized = color.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
      setError('색상 코드는 #RRGGBB 형식으로 입력해 주세요.');
      return;
    }
    const message = onColorChange(normalized);
    if (message) { setError(message); return; }
    setCustomColor(normalized);
    setError('');
  }

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = trigger.current;
      const popover = panel.current;
      if (!anchor || !popover) return;
      if (!anchor.getClientRects().length) { setOpen(false); return; }
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const margin = 8;
      const gap = 6;
      const minLeft = viewportLeft + margin;
      const minTop = viewportTop + margin;
      const maxRight = viewportLeft + viewportWidth - margin;
      const maxBottom = viewportTop + viewportHeight - margin;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < viewportTop || rect.top > viewportTop + viewportHeight || rect.right < viewportLeft || rect.left > viewportLeft + viewportWidth) {
        setOpen(false);
        return;
      }
      const width = Math.max(0, Math.min(252, viewportWidth - margin * 2));
      const maxHeight = Math.max(0, viewportHeight - margin * 2);
      const height = Math.min(popover.getBoundingClientRect().height, maxHeight);
      const left = Math.max(minLeft, Math.min(rect.right - width, maxRight - width));
      const preferredTop = rect.bottom + gap + height <= maxBottom ? rect.bottom + gap : rect.top - gap - height;
      const top = Math.max(minTop, Math.min(preferredTop, maxBottom - height));
      setPosition(previous => previous?.left === left && previous.top === top && previous.maxHeight === maxHeight && previous.width === width ? previous : { left, top, maxHeight, width });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const initial = palette.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? palette.current?.querySelector<HTMLButtonElement>('button');
    initial?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open]);

  useEffect(() => {
    if (open && customOpen) hexInput.current?.focus({ preventScroll: true });
  }, [open, customOpen]);

  function navigatePalette(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(palette.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'ArrowDown') next = (index + 6) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 6 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return <>
    <button ref={trigger} type="button" className={`icon-button category-options-trigger${compact ? ' category-options-compact' : ''}`} aria-label={`${category.label} 옵션`} title={`${category.label} 옵션`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled} onClick={toggle}><EllipsisVertical size={compact ? 14 : 16} aria-hidden="true" /></button>
    {open && !disabled && createPortal(<div ref={panel} id={panelId} className="category-options-popover" role="dialog" aria-label={`${category.label} 옵션`} style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}>
      <div className="category-options-heading"><strong>{category.label}</strong><button type="button" className="icon-button" aria-label="옵션 닫기" onClick={() => close(true)}><X size={16} aria-hidden="true" /></button></div>
      <p className="category-options-caption">표시 색상</p>
      <div ref={palette} className="category-options-palette" role="group" aria-label="색상 선택" onKeyDown={navigatePalette}>
        {COLORS.map(color => <button type="button" key={color.value} className="category-options-swatch" style={{ '--swatch-color': color.value, '--swatch-check': checkColor(color.value) } as React.CSSProperties} aria-label={`${color.label} 색상 ${color.value}`} aria-pressed={selectedColor === color.value} title={`${color.label} ${color.value}`} onClick={() => saveColor(color.value)}><span>{selectedColor === color.value && <Check size={17} strokeWidth={2.8} aria-hidden="true" />}</span></button>)}
      </div>
      <div className="category-options-custom-row"><button type="button" className="category-options-custom-toggle" aria-label="사용자 지정 색상" aria-expanded={customOpen} aria-controls={customOpen ? customId : undefined} onClick={() => { setCustomOpen(value => !value); setCustomColor(selectedColor); setError(''); }}><Plus size={17} aria-hidden="true" /><span>사용자 지정 색상</span></button>{customSelected && <span className="category-options-current" title={`현재 색상 ${selectedColor}`} aria-label={`현재 색상 ${selectedColor}`} style={{ backgroundColor: category.color, color: checkColor(selectedColor) }}><Check size={12} strokeWidth={2.8} aria-hidden="true" /></span>}</div>
      {customOpen && <div id={customId} className="category-options-custom">
        <label className="category-options-hex-label">색상 코드<input ref={hexInput} className="input" value={customColor} maxLength={7} placeholder="#RRGGBB" spellCheck={false} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => { setCustomColor(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveColor(customColor); } }} /></label>
        <div className="category-options-custom-actions"><input type="color" aria-label="사용자 지정 색상 선택" value={/^#[0-9a-f]{6}$/i.test(customColor) ? customColor : category.color} onChange={event => { setCustomColor(event.target.value.toUpperCase()); setError(''); }} /><button type="button" className="button button-secondary" onClick={() => saveColor(customColor)}>색상 적용</button></div>
      </div>}
      {error && <p id={errorId} className="category-options-error" role="alert">{error}</p>}
      {onDelete && <div className="category-options-footer"><button type="button" className="category-options-delete" onClick={() => { close(true); onDelete(); }}><Trash2 size={15} aria-hidden="true" />일정 종류 삭제</button></div>}
    </div>, document.body)}
  </>;
}
