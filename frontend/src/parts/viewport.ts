interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}
let scale = 1;

/** Display widths are browser CSS pixels; all component layout stays in its original units. */
function managementDisplay(width: number, contentWidth = width) {
  const scale = 1 - Math.min(1, Math.max(0, (width - 1280) / 256)) * 0.04;
  const frame = Math.min(contentWidth, Math.max(1100, contentWidth * 0.859375));
  const table = Math.max(0, frame - 32);
  return {
    scale,
    mainWidth: table / scale + 32,
    mainLeft: ((contentWidth - frame) / 2 + 16) / scale - 16,
  };
}

export function layoutValue(value: number, ratio = scale) {
  return value / ratio;
}
function layoutBounds(rect: Rect, ratio = scale) {
  return {
    left: rect.left / ratio,
    right: rect.right / ratio,
    top: rect.top / ratio,
    bottom: rect.bottom / ratio,
    width: rect.width / ratio,
    height: rect.height / ratio,
  };
}
export function layoutRect(node: Element) {
  return layoutBounds(node.getBoundingClientRect());
}
export function viewport() {
  return {
    width: layoutValue(window.innerWidth),
    height: layoutValue(window.innerHeight),
    scrollX: layoutValue(window.scrollX),
    scrollY: layoutValue(window.scrollY),
    scrollHeight: layoutValue(document.documentElement.scrollHeight),
  };
}
export function scrollWindow(top: number, left = viewport().scrollX) {
  window.scrollTo({ top: top * scale, left: left * scale, behavior: 'instant' });
}
export function layoutScrollTop(node: Element) {
  return node === document.scrollingElement ? layoutValue(node.scrollTop) : node.scrollTop;
}
export function setLayoutScrollTop(node: Element, top: number) {
  node.scrollTop = node === document.scrollingElement ? top * scale : top;
}

/** Installed only by the management entry, before its first component is measured. */
export function setupManagementViewport() {
  let last = '';
  const update = () => {
    // Unlike clientWidth while overflow is hidden, this excludes the stable scrollbar gutter.
    const contentWidth = document.documentElement.getBoundingClientRect().width;
    const dimensions = `${window.innerWidth}:${window.innerHeight}:${contentWidth}`;
    if (dimensions === last) return;
    last = dimensions;
    const display = managementDisplay(window.innerWidth, contentWidth);
    scale = display.scale;
    const style = document.body.style;
    style.setProperty('--management-scale', String(scale));
    style.setProperty('--management-main-width', `${display.mainWidth}px`);
    style.setProperty('--management-main-left', `${display.mainLeft}px`);
    style.setProperty('--viewport-width', `${viewport().width}px`);
    style.setProperty('--viewport-height', `${viewport().height}px`);
  };
  document.body.dataset.management = '';
  update();
  window.addEventListener('resize', update);
  new ResizeObserver(update).observe(document.documentElement);
}
