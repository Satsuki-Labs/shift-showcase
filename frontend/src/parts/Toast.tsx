import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFloating, type NoticePlacement } from './Floating';
import './Toast.css';

interface ToastProps {
  anchor?: RefObject<HTMLDivElement | null>;
  placement?: NoticePlacement;
  open?: boolean;
  className?: string;
  icon: ReactNode;
  message: string;
  label: string;
  code?: string;
  warn?: boolean;
  raised?: boolean;
  phase?: 'in' | 'out';
  onExited?: () => void;
}

export function Toast({
  anchor,
  placement = 'notice-space',
  open = true,
  className,
  icon,
  message,
  label,
  code,
  warn = false,
  raised = false,
  phase = 'in',
  onExited,
}: ToastProps) {
  const popup = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const updateHovered = useCallback(() => {
    const bounds = popup.current?.getBoundingClientRect(),
      point = pointer.current;
    setHovered(
      Boolean(
        bounds &&
        point &&
        point.x >= bounds.left &&
        point.x <= bounds.right &&
        point.y >= bounds.top &&
        point.y <= bounds.bottom,
      ),
    );
  }, []);
  useFloating(popup, { open, anchor: () => anchor?.current, placement });
  useEffect(() => {
    updateHovered();
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      updateHovered();
    };
    const leave = () => {
      pointer.current = null;
      setHovered(false);
    };
    const observer = new ResizeObserver(updateHovered);
    if (popup.current) observer.observe(popup.current);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerleave', leave);
    window.addEventListener('resize', updateHovered);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', updateHovered);
    };
  }, [open, updateHovered]);
  if (!open) return null;
  return (
    <div
      ref={popup}
      className={`save-popup${raised ? ' raised' : ''}${hovered ? ' hovered' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        className={`toast ${phase}${warn ? ' warn' : ''}`}
        onAnimationEnd={(event) => {
          updateHovered();
          if (event.target === event.currentTarget && event.animationName === 'toast-out')
            onExited?.();
        }}
      >
        {icon}
        <div className="toast-content">
          {(message.match(/[^。]+。?/g) ?? []).map((sentence, index) => (
            <span className="toast-line" key={index}>
              {sentence}
            </span>
          ))}
          <div className="toast-detail">
            <small>{label}</small>
            {code && <span className="code">{code}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
