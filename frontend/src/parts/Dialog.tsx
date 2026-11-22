import { layoutRect } from './viewport';
import { dismissUnchangedDialog } from './dialog-dismiss';
import { dialogPosition } from './dialog-position';
import './Dialog.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { motionMs } from './motion';
import { createPortal } from 'react-dom';
import { Save, X } from 'lucide-react';
import { Reveal } from './Reveal';
import { WarningMark } from './icons';
import { registerChangedEditor } from '../saving/window';
import { guardRevealedContent, usePressGuard } from './usePressGuard';

interface DialogScope {
  node: HTMLElement;
  focus: (target: HTMLElement | null | undefined) => void;
}
const dialogs: DialogScope[] = [];
const focusSelector =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const canFocus = (node: HTMLElement) =>
  node.isConnected &&
  !node.matches(':disabled') &&
  !node.closest('[inert]') &&
  node.getClientRects().length > 0 &&
  getComputedStyle(node).visibility !== 'hidden';
const focusWithoutScroll = (node: HTMLElement | null | undefined) => {
  if (node && canFocus(node)) node.focus({ preventScroll: true });
};
function focusInDialog(target: HTMLElement | null | undefined) {
  if (!target) return;
  for (let index = dialogs.length - 1; index >= 0; index--) {
    const owner = dialogs[index];
    if (owner.node.closest('.dim')?.contains(target)) {
      owner.focus(target);
      return;
    }
  }
}
export function useDialogFocus() {
  return useCallback(focusInDialog, []);
}
function hasMoreAbove(scrollTop: number) {
  return scrollTop >= 1;
}
function hasMoreBelow(scrollTop: number, clientHeight: number, scrollHeight: number) {
  return scrollHeight > clientHeight && scrollHeight - clientHeight - scrollTop >= 1;
}
export function dialogScrollTop(
  body: HTMLElement,
  target: { selector: string; bottomGap: number },
) {
  const bottoms = Array.from(body.querySelectorAll(target.selector)).map(
    (row) => layoutRect(row).bottom - layoutRect(body).top + body.scrollTop,
  );
  return bottoms.length
    ? Math.max(0, Math.max(...bottoms) + target.bottomGap - body.clientHeight)
    : undefined;
}
const dialogListeners = new Set<() => void>();
const subscribeDialogs = (listener: () => void) => {
  dialogListeners.add(listener);
  return () => {
    dialogListeners.delete(listener);
  };
};
export const getOpenDialogCount = () => dialogs.length;
export function useOpenDialogCount() {
  return useSyncExternalStore(subscribeDialogs, getOpenDialogCount);
}
export function SaveConflictNotice({
  disabled,
  confirm,
  confirmLabel = '保存内容に置き変える',
}: {
  disabled: boolean;
  confirm?: () => void;
  confirmLabel?: string;
}) {
  return (
    <div className={`notice warn staff-conflict${confirm ? '' : ' without-confirm'}`}>
      <WarningMark size={22} />
      <span>保存内容が変わりました</span>
      {confirm && (
        <button className="btn btn-small" type="button" disabled={disabled} onClick={confirm}>
          {confirmLabel}
        </button>
      )}
    </div>
  );
}
export function SaveButton({
  disabled,
  showSpinner,
  conflict,
  submit,
}: {
  disabled: boolean;
  showSpinner: boolean;
  conflict: boolean;
  submit: () => void;
}) {
  return (
    <button className="btn btn-main" type="button" disabled={disabled} onClick={submit}>
      {showSpinner ? <span className="spinner" /> : <Save size={22} strokeWidth={2} />}
      <span className="save-label">
        <Reveal reserveSpace open={!conflict}>
          保存する
        </Reveal>
        <Reveal reserveSpace open={conflict}>
          保存し直す
        </Reveal>
      </span>
    </button>
  );
}
export function Dialog({
  title,
  icon,
  header,
  headerEnd,
  close,
  children,
  footer,
  footerStart,
  notice,
  className = '',
  changed = false,
  open = true,
  appear = true,
  hideClose = false,
  dismissible = true,
  subtitle,
  long = false,
  animateHeight = false,
  initialFocus,
  initialScrollTo,
  resetScrollOn,
}: {
  title: string;
  icon: ReactNode;
  close: () => void;
  children: ReactNode;
  header?: ReactNode;
  headerEnd?: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  notice?: ReactNode;
  className?: string;
  changed?: boolean;
  open?: boolean;
  appear?: boolean;
  hideClose?: boolean;
  dismissible?: boolean;
  subtitle?: ReactNode;
  long?: boolean;
  animateHeight?: boolean;
  initialFocus?: () => HTMLElement | null | undefined;
  initialScrollTo?: { selector: string; bottomGap: number };
  resetScrollOn?: string | number;
}) {
  const root = useRef<HTMLElement>(null);
  const scrollBody = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pressGuard = usePressGuard();
  const automaticClose = useRef(false);
  useEffect(() => (changed ? registerChangedEditor() : undefined), [changed]);
  useLayoutEffect(() => {
    const node = root.current,
      inner = content.current;
    if (!node) return;
    const dim = node.closest<HTMLElement>('.dim')!;
    const body = node.querySelector<HTMLElement>('.dlg-body')!;
    const head = node.querySelector<HTMLElement>('.dlg-head')!;
    const foot = node.querySelector<HTMLElement>('.dlg-foot');
    let anchorTop: number | undefined, lastHeight: number | undefined;
    let anchored = false,
      initialized = false,
      swapping = false;
    let heightMotion: { height: number; top: number } | undefined;
    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    let revealFrame: number | undefined;
    const placement = (height: number, top?: number) => {
      const bounds = layoutRect(dim),
        style = getComputedStyle(dim);
      const result = dialogPosition(
        height,
        bounds.height,
        parseFloat(style.paddingTop),
        parseFloat(style.paddingBottom),
        top === undefined ? undefined : top - bounds.top,
      );
      return { height: result.height, top: result.top + bounds.top };
    };
    const transform = (top: number) => {
      const shift = top - placement(0).top;
      return `translateY(calc(50% ${shift < 0 ? '-' : '+'} ${Math.abs(shift)}px))`;
    };
    const place = () => {
      const height = layoutRect(node).height;
      if (heightMotion) {
        if (Math.abs(height - heightMotion.height) >= 0.02) return;
        anchorTop = heightMotion.top;
        heightMotion = undefined;
        node.style.transition = '';
      }
      if (lastHeight !== undefined && Math.abs(height - lastHeight) >= 0.02) anchored = true;
      anchorTop = placement(height, anchorTop).top;
      lastHeight = height;
      // The percentage follows the actual height in the same layout frame.
      node.style.transform = anchored ? transform(anchorTop) : '';
    };
    const naturalHeight = () => {
      const style = getComputedStyle(node),
        bodyStyle = getComputedStyle(body);
      const footStyle = foot ? getComputedStyle(foot) : undefined;
      const natural =
        layoutRect(head).height +
        (foot ? layoutRect(foot).height : 0) +
        (footStyle ? parseFloat(footStyle.marginTop) + parseFloat(footStyle.marginBottom) : 0) +
        layoutRect(inner!).height +
        parseFloat(bodyStyle.paddingTop) +
        parseFloat(bodyStyle.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      return Math.min(natural, parseFloat(style.maxHeight));
    };
    const revealing = () =>
      inner!
        .getAnimations({ subtree: true })
        .some(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === 'height',
        ) ||
      Array.from(inner!.querySelectorAll<HTMLElement>('.reveal-frame')).some(
        (element) => element.style.height !== '' && element.style.transition === 'none',
      );
    const setHeight = (height: number, animate: boolean) => {
      const bounds = layoutRect(node);
      if (heightMotion) anchorTop = bounds.top;
      const target = placement(height, anchorTop);
      const changing = Math.abs(bounds.height - target.height) >= 0.02;
      if (initialized && changing) anchored = true;
      heightMotion = undefined;
      node.style.transition = 'none';
      if (animate && changing) {
        anchored = true;
        node.style.height = `${bounds.height}px`;
        node.style.transform = transform(bounds.top);
        void node.offsetHeight;
        node.style.transition =
          'height var(--reveal-duration) var(--ease-standard), transform var(--reveal-duration) var(--ease-standard)';
        heightMotion = target;
        node.style.height = `${target.height}px`;
        node.style.transform = transform(target.top);
      } else {
        node.style.height = `${target.height}px`;
        anchorTop = target.top;
        place();
      }
    };
    const resize = () => {
      if (swapping) return;
      const followsReveal = revealing();
      setHeight(
        naturalHeight(),
        initialized && !followsReveal && motionMs(node, '--reveal-duration') > 0,
      );
      initialized = true;
      if (!followsReveal && !heightMotion) node.style.transition = '';
      if (followsReveal && revealFrame === undefined)
        revealFrame = requestAnimationFrame(() => {
          revealFrame = undefined;
          resize();
        });
    };
    const swap = () => {
      clearTimeout(swapTimer);
      swapping = false;
      setHeight(naturalHeight(), motionMs(node, '--reveal-duration') > 0);
      swapping = true;
      swapTimer = setTimeout(
        () => {
          swapping = false;
          resize();
        },
        motionMs(node, '--reveal-duration'),
      );
    };
    const recenter = () => {
      heightMotion = undefined;
      anchorTop = undefined;
      lastHeight = undefined;
      anchored = false;
      node.style.transform = '';
      if (animateHeight && inner) {
        node.style.transition = 'none';
        node.style.height = `${placement(naturalHeight()).height}px`;
        void node.offsetHeight;
        node.style.transition = '';
      }
      place();
    };
    if (animateHeight && inner) resize();
    else place();
    const frameObserver = new ResizeObserver(place);
    frameObserver.observe(node);
    const contentObserver = new ResizeObserver(resize);
    if (animateHeight && inner) {
      inner.addEventListener('reveal-swap', swap);
      [inner, head, ...(foot ? [foot] : [])].forEach((element) => contentObserver.observe(element));
    }
    // Reveal writes height during RAF. Follow it before other RAF readers run.
    const mutations = new MutationObserver(() => {
      if (animateHeight && inner) resize();
      else place();
    });
    mutations.observe(body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    mutations.observe(node, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', recenter);
    return () => {
      clearTimeout(swapTimer);
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
      inner?.removeEventListener('reveal-swap', swap);
      frameObserver.disconnect();
      contentObserver.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', recenter);
      node.style.height = '';
      node.style.transition = '';
      node.style.transform = '';
    };
  }, [animateHeight]);
  useLayoutEffect(() => {
    if (!initialScrollTo) return;
    const body = scrollBody.current!;
    const top = dialogScrollTop(body, initialScrollTo);
    if (top !== undefined) body.scrollTop = top;
  }, []);
  useLayoutEffect(() => {
    if (resetScrollOn !== undefined) scrollBody.current!.scrollTop = 0;
  }, [resetScrollOn]);
  useLayoutEffect(() => {
    const node = root.current!,
      body = scrollBody.current!;
    const head = node.querySelector<HTMLElement>('.dlg-head')!;
    const foot = node.querySelector<HTMLElement>('.dlg-foot');
    const update = () => {
      let availableHeight = body.clientHeight;
      if (animateHeight) {
        const style = getComputedStyle(node),
          bodyStyle = getComputedStyle(body);
        const footStyle = foot ? getComputedStyle(foot) : undefined;
        availableHeight =
          parseFloat(style.maxHeight) -
          layoutRect(head).height -
          (foot ? layoutRect(foot).height : 0) -
          (footStyle ? parseFloat(footStyle.marginTop) + parseFloat(footStyle.marginBottom) : 0) -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth) -
          parseFloat(bodyStyle.paddingTop) -
          parseFloat(bodyStyle.paddingBottom);
      }
      body.dataset.moreAbove = String(hasMoreAbove(body.scrollTop));
      body.dataset.moreBelow = String(
        hasMoreBelow(body.scrollTop, availableHeight, body.scrollHeight),
      );
    };
    const observer = new ResizeObserver(update);
    const observeContent = () => {
      observer.disconnect();
      observer.observe(body);
      Array.from(body.children).forEach((child) => observer.observe(child));
      update();
    };
    const mutations = new MutationObserver(observeContent);
    mutations.observe(body, { subtree: true, childList: true, characterData: true });
    observeContent();
    body.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      body.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [animateHeight]);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const composing = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [visible, setVisible] = useState(!appear);
  const closing = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  const focusable = useCallback(
    () =>
      Array.from(
        root.current!.closest('.dim')!.querySelectorAll<HTMLElement>(focusSelector),
      ).filter(canFocus),
    [],
  );
  const moveFocus = useCallback((target: HTMLElement | null | undefined) => {
    if (closing.current || !openRef.current || dialogs[dialogs.length - 1]?.node !== root.current)
      return;
    if (target && root.current!.closest('.dim')!.contains(target)) focusWithoutScroll(target);
  }, []);
  const requestClose = useCallback((automatic = false) => {
    if (closing.current) return;
    automaticClose.current = automatic;
    closing.current = true;
    setVisible(false);
    const duration = motionMs(root.current!.closest('.dim')!, '--dialog-duration');
    timer.current = setTimeout(() => closeRef.current(), duration);
  }, []);
  useLayoutEffect(() => {
    let frame: number | undefined;
    if (appear) {
      void root.current?.offsetHeight;
      frame = requestAnimationFrame(() => {
        if (!closing.current) setVisible(true);
      });
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!open) requestClose(true);
  }, [open, requestClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const returnTargets: HTMLElement[] = previous ? [previous] : [];
    for (
      let context = previous;
      context?.parentElement && context.parentElement !== document.body;
      context = context.parentElement
    ) {
      const nearby = Array.from(context.parentElement.querySelectorAll<HTMLElement>(focusSelector));
      const index = nearby.findIndex(
        (element) => element === previous || element.contains(previous),
      );
      const ordered = nearby
        .map((element, position) => ({ element, distance: Math.abs(position - index) }))
        .sort((left, right) => left.distance - right.distance);
      returnTargets.push(
        ...ordered
          .map((item) => item.element)
          .filter((element) => !returnTargets.includes(element)),
      );
    }
    const scope = root.current!.closest('.dim')!;
    const owner = { node: root.current!, focus: moveFocus };
    dialogs.push(owner);
    dialogListeners.forEach((listener) => listener());
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        dialogs[dialogs.length - 1]?.node !== root.current ||
        closing.current
      )
        return;
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        !composing.current
      ) {
        dismissUnchangedDialog(
          dismissibleRef.current,
          changedRef.current,
          () => false,
          () => {
            event.preventDefault();
            requestClose();
          },
        );
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !scope.contains(document.activeElement))
      ) {
        event.preventDefault();
        moveFocus(last);
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !scope.contains(document.activeElement))
      ) {
        event.preventDefault();
        moveFocus(first);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      dialogs.splice(dialogs.indexOf(owner), 1);
      document.removeEventListener('keydown', keydown);
      if (automaticClose.current) guardRevealedContent();
      const target = returnTargets.find(canFocus);
      if (target?.closest('.dim')) focusInDialog(target);
      else focusWithoutScroll(target);
      dialogListeners.forEach((listener) => listener());
    };
  }, [requestClose, focusable, moveFocus]);
  useEffect(() => {
    const elements = focusable();
    moveFocus(
      initialFocus
        ? initialFocus()
        : (elements.find((element) => element.matches('input, textarea')) ?? elements[0]),
    );
  }, [initialFocus, focusable, moveFocus]);
  return createPortal(
    <div
      className={`dim${visible ? ' open' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget)
          dismissUnchangedDialog(dismissible, changed, pressGuard.blocked, requestClose);
      }}
    >
      <section
        className={`dlg scrollbar-thin ${className}${long ? ' dlg-long' : ''}${animateHeight ? ' animate-height' : ''}`}
        ref={root}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      >
        <div className="dlg-head">
          <div className={`dlg-heading${header ? ' dlg-custom-heading' : ''}`}>
            {header ?? (
              <>
                <b>
                  {icon}
                  {title}
                </b>
                {subtitle && <small>{subtitle}</small>}
              </>
            )}
          </div>
          {headerEnd}
          {!hideClose && (
            <button className="icon-button dlg-close" type="button" onClick={() => requestClose()}>
              <X size={24} strokeWidth={2.6} />
            </button>
          )}
        </div>
        <div ref={scrollBody} className="dlg-body scrollbar-thin">
          {animateHeight ? (
            <div ref={content} className="dlg-content">
              {children}
            </div>
          ) : (
            children
          )}
        </div>
        {footer && (
          <div className={`dlg-foot${notice ? ' with-notice' : ''}`}>
            {footerStart && <div className="dlg-footer-start">{footerStart}</div>}
            <Reveal open={Boolean(notice)} reserveSpace className="dlg-footer-notice">
              {notice}
            </Reveal>
            <div className="dlg-footer-end">{footer}</div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
