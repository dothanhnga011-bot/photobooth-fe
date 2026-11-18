import { useLayoutEffect, useState } from 'react';
import { fitGrid } from './fit-grid.js';

// Share the measured grid between captured photos and blank frame choices.
export function useFitGrid(count, { aspect = 3 / 2, frame = 8, min = 120 } = {}) {
  const [element, ref] = useState(null), [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = fitGrid(entry.contentRect.width, entry.contentRect.height, count, { aspect, frame, min });
      setLayout(old => old && next && old.cols === next.cols && old.size === next.size && old.scroll === next.scroll ? old : next);
    });
    observer.observe(element); return () => observer.disconnect();
  }, [element, count, aspect, frame, min]);
  return { ref, fitted: Boolean(layout && !layout.scroll),
    style: layout ? { gridTemplateColumns: `repeat(${layout.cols}, ${layout.size}px)` } : undefined };
}
