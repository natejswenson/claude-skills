import { useLayoutEffect, useRef, useState } from 'react';
import './ImageOutput.css';

export function fitImage(width: number, height: number, availableWidth: number, availableHeight: number) {
    return width > 0 && height > 0 ? Math.min(1, availableWidth / width, availableHeight / height) : 0;
}

export function stepImageZoom(scale: number, direction: number) {
    return Math.max(.25, Math.min(4, (direction > 0 ? Math.floor(scale * 4 + 1e-8) + 1 : Math.ceil(scale * 4 - 1e-8) - 1) / 4));
}

export function imageScrollCenter({ width, height, viewportWidth, viewportHeight, left, top, from, to }: {
    width: number; height: number; viewportWidth: number; viewportHeight: number;
    left: number; top: number; from: number; to: number;
}) {
    const axis = (pixels: number, viewport: number, scroll: number) => {
        const point = (scroll + viewport / 2 - Math.max(0, (viewport - pixels * from) / 2)) / from;
        return Math.max(0, Math.min(Math.max(0, pixels * to - viewport), point * to - viewport / 2));
    };
    return { left: axis(width, viewportWidth, left), top: axis(height, viewportHeight, top) };
}

// The caller keys this component by artifact URL, resetting dimensions and zoom for each revision.
export function ImageOutput({ url, name }: { url: string; name: string }) {
    const viewport = useRef<HTMLDivElement>(null);
    const [natural, setNatural] = useState({ width: 0, height: 0 });
    const [available, setAvailable] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState<number | null>(null);
    const [failed, setFailed] = useState(false);
    const pendingCenter = useRef<{ left: number; top: number } | null>(null);
    const ready = natural.width > 0 && natural.height > 0 && !failed;
    const scale = zoom ?? fitImage(natural.width, natural.height, available.width, available.height);
    const width = natural.width * scale, height = natural.height * scale;
    const overflow = ready && (width > available.width || height > available.height);

    useLayoutEffect(() => {
        const element = viewport.current!;
        const measure = () => setAvailable({ width: element.clientWidth, height: element.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const changeZoom = (next: number | null) => {
        const element = viewport.current;
        const target = next ?? fitImage(natural.width, natural.height, available.width, available.height);
        // Capture before layout can clamp the old scroll position on zoom-out.
        if (element && scale > 0) pendingCenter.current = imageScrollCenter({ ...natural,
            viewportWidth: element.clientWidth, viewportHeight: element.clientHeight,
            left: element.scrollLeft, top: element.scrollTop, from: scale, to: target });
        setZoom(next);
    };

    useLayoutEffect(() => {
        const element = viewport.current, center = pendingCenter.current;
        if (element && center) {
            element.scrollLeft = center.left;
            element.scrollTop = center.top;
        }
        pendingCenter.current = null;
    }, [scale, zoom]);

    return <div className="image-output">
        <div className="image-output-meta"><strong>{name}</strong>{ready && <span>{natural.width} × {natural.height}</span>}</div>
        <div className="image-output-controls" role="group" aria-label="Image zoom">
            <button disabled={!ready} aria-pressed={zoom === null} onClick={() => changeZoom(null)}>Fit</button>
            <button disabled={!ready} aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>Actual size</button>
            <button disabled={!ready || scale <= .25} aria-label="Zoom out" onClick={() => changeZoom(stepImageZoom(scale, -1))}>−</button>
            <output aria-label="Zoom percentage">{ready ? `${Math.round(scale * 100)}%` : '—'}</output>
            <button disabled={!ready || scale >= 4} aria-label="Zoom in" onClick={() => changeZoom(stepImageZoom(scale, 1))}>+</button>
        </div>
        <div className="image-output-viewport" ref={viewport} tabIndex={0} role="region" aria-label={`${name} image viewport`}>
            {failed ? <p role="alert">Could not load this image. Try selecting the output again or download it.</p> : <>
                {!ready && <p role="status">Loading image…</p>}
                <div className="image-output-stage" style={{ width, height }}>
                    <img src={url} alt={name} draggable={false} style={{ width, height, visibility: ready ? 'visible' : 'hidden' }}
                        onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; setNatural({ width: naturalWidth, height: naturalHeight }); setFailed(!naturalWidth || !naturalHeight); }}
                        onError={() => setFailed(true)}/>
                </div>
            </>}
        </div>
        <p className="image-output-hint">{overflow ? 'Scroll to pan. Use arrow keys when the image is focused, or swipe on touch screens.' : 'Fit shows the whole image. Actual size shows its native pixels.'}</p>
    </div>;
}
